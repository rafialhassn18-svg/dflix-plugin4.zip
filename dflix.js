// DFLIX scraper for Nuvio (Legacy tpk / plugin runtime) - DEBUG v2 (shows real errors)
// Movies: CineplexBD + ShowTime.  Series: ShowTime only.

var CX = "http://cineplexbd.net";
var ST = "http://10.100.100.10";
var UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
var DEFAULT_TMDB_KEY = "7720837cae51542c691532949b360141";
var VIDX = /\.(mp4|mkv|avi|m4v|mov|webm|ts|mpg|wmv|flv)(\?|$)/i;
var QUALITY = /(2160p|4k|1080p|720p|480p|WEB-?DL|WEBRip|BluRay|HDRip|DVDRip|HDTV|CAMRip|HDCAM)/i;

var DBG = [];
function dbg(s) { DBG.push(s); }

function tmdbKey() {
  var s = typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS ? SCRAPER_SETTINGS : {};
  return (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || s.tmdbKey || DEFAULT_TMDB_KEY;
}

function shortUrl(u) {
  return String(u).replace(/^https?:\/\//, "").split("?")[0].slice(0, 40);
}

function cxHeaders() {
  return { "User-Agent": UA, "Referer": CX + "/", "Accept": "application/json, text/html, */*", "X-Requested-With": "XMLHttpRequest" };
}

function getText(url, headers) {
  return (headers ? fetch(url, { headers: headers }) : fetch(url)).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }).catch(function (e) {
    dbg("ERR " + shortUrl(url) + " -> " + (e && e.message ? e.message : e));
    throw e;
  });
}

function fix(u) {
  return String(u)
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
    .replace(/[ \[\]"<>^`{|}\\]/g, function (c) { return encodeURIComponent(c); })
    .replace(/#/g, "%23");
}

function absUrl(h, base) {
  h = String(h || "");
  if (/^https?:/i.test(h)) return h;
  base = base || CX + "/";
  var origin = (base.match(/^https?:\/\/[^\/]+/i) || [""])[0];
  if (h.charAt(0) === "/") return origin + h;
  return base.replace(/[^\/]*$/, "") + h.replace(/^\.\//, "");
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function baseTitle(s) {
  var cut = String(s || "").split(/[\(\[]|\b(?:19|20)\d{2}\b|2160p|1080p|720p|480p|WEB-?DL|BluRay|HDRip/i)[0];
  return norm(cut);
}

function yearOf(s) {
  var m = String(s || "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function titleMatches(title, year, wantTitle, wantYear) {
  if (baseTitle(title) !== norm(wantTitle)) return false;
  var y = Number(year) || yearOf(title);
  if (wantYear && y && Math.abs(y - wantYear) > 1) return false;
  return true;
}

function episodeMatches(name, season, episode) {
  var re = new RegExp("(?:s0*" + season + "[\\s._-]*e0*" + episode + "(?!\\d))|(?:\\b0*" + season + "x0*" + episode + "(?!\\d))", "i");
  return re.test(name);
}

function cxVideos(html, base) {
  var clean = html.replace(/\\\//g, "/");
  var out = clean.match(/https?:\/\/[^"'\s<>\\]+?\.(?:mp4|mkv|m3u8|avi|webm|mov)(?:\?[^"'\s<>\\]*)?/gi) || [];
  var re = /["']([^"'<>]+?\.(?:mp4|mkv|m3u8|avi|webm|mov)(?:\?[^"'<>]*)?)["']/gi, m;
  while ((m = re.exec(clean))) out.push(absUrl(m[1], base));
  var seen = {};
  return out.map(fix).filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
}

function makeStream(label, url, title, withHeaders) {
  var q = (String(title).match(QUALITY) || [])[1] || "Unknown";
  var s = { name: label, title: title, quality: /^\d+p$/i.test(q) ? q.toLowerCase() : q.toUpperCase(), url: url };
  if (withHeaders) s.headers = { "User-Agent": UA, Referer: CX + "/" };
  return s;
}

function getInfo(tmdbId, mediaType) {
  var kind = mediaType === "movie" ? "movie" : "tv";
  return getText("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + tmdbKey()).then(function (t) {
    var j = JSON.parse(t);
    return { name: j.title || j.name || "", year: yearOf(j.release_date || j.first_air_date) };
  });
}

function searchCx(title) {
  return getText(CX + "/search_ajax.php?q=" + encodeURIComponent(title) + "&limit=30", cxHeaders())
    .then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { dbg("CX not JSON: " + String(t).slice(0, 60).replace(/\s+/g, " ")); return []; }
      var arr = j.results || j || [];
      if (!arr.map) { dbg("CX unexpected JSON"); return []; }
      return arr.map(function (i) {
        var isSeries = String(i.type || "").toLowerCase() === "series";
        return { series: isSeries, title: i.title || "", year: i.year ? Number(i.year) : null,
                 href: absUrl(i.url || (isSeries ? "tview.php?id=" : "view.php?id=") + i.id), category: i.category || "" };
      });
    })
    .catch(function () { return []; });
}

function searchSt(title) {
  return getText(ST + "/movie/search?search=" + encodeURIComponent(title))
    .then(function (html) {
      if (typeof cheerio === "undefined") { dbg("cheerio missing"); return { files: [], dirs: [] }; }
      var $ = cheerio.load(html), files = [], dirs = [];
      var n = $(".single_movie").length;
      if (!n) dbg("ST page ok (" + String(html).length + "b) but no .single_movie");
      $(".single_movie").toArray().forEach(function (el) {
        var m = $(el);
        var ttl = (m.find("figcaption a").first().text() || "").replace(/\s+/g, " ").trim();
        var dl = m.find("figcaption p a[href]").first().attr("href") || "";
        if (!ttl || !dl) return;
        var url = fix(absUrl(dl, ST + "/"));
        if (VIDX.test(dl)) files.push({ title: ttl, url: url, size: (m.find("h6").first().text() || "").trim() });
        else if (/\/$/.test(dl.split("?")[0]) && /SERIES|SHOW/i.test(dl)) dirs.push({ title: ttl, url: url });
      });
      return { files: files, dirs: dirs };
    })
    .catch(function () { return { files: [], dirs: [] }; });
}

function dirScan(url) {
  return getText(url)
    .then(function (html) {
      var $ = cheerio.load(html), base = fix(url.replace(/\/?$/, "/")), files = [], subs = [], seen = {};
      $("a[href]").toArray().forEach(function (el) {
        var h = $(el).attr("href") || "";
        if (!h || /^(\.\.?\/|\?|#|mailto:|javascript:)/i.test(h)) return;
        var u = /^https?:/i.test(h) ? h : h.charAt(0) === "/" ? (base.match(/^https?:\/\/[^\/]+/i) || [""])[0] + h : base + h.replace(/^\.?\//, "");
        u = u.split("#")[0];
        if (base.indexOf(u.replace(/\/?$/, "/")) === 0 || u.indexOf(base) !== 0 || seen[u]) return;
        seen[u] = 1;
        var rel = u.slice(base.length), name = rel;
        try { name = decodeURIComponent(rel.split("?")[0]); } catch (e) {}
        if (VIDX.test(rel)) files.push({ url: u, name: name });
        else if (/\/$/.test(rel.split("?")[0])) subs.push({ url: u, name: name.replace(/\/$/, "") });
      });
      return { files: files, subs: subs };
    })
    .catch(function () { return null; });
}

function movieStreams(info) {
  return Promise.all([searchCx(info.name), searchSt(info.name)]).then(function (res) {
    var out = [];
    dbg("CX raw " + res[0].length + " | ST files " + res[1].files.length + " dirs " + res[1].dirs.length);
    var cxHits = res[0].filter(function (h) { return !h.series && titleMatches(h.title, h.year, info.name, info.year); }).slice(0, 3);
    dbg("CX matched " + cxHits.length);
    if (res[0].length && !cxHits.length) dbg("CX first: " + res[0][0].title + " " + (res[0][0].year || ""));
    res[1].files.filter(function (h) { return titleMatches(h.title, null, info.name, info.year); }).forEach(function (h) {
      out.push(makeStream("ShowTime", h.url, h.title + (h.size ? " · " + h.size : ""), false));
    });
    return Promise.all(cxHits.map(function (hit) {
      return getText(hit.href, cxHeaders())
        .then(function (html) {
          cxVideos(html, hit.href).forEach(function (u) {
            out.push(makeStream("CineplexBD", u, hit.title + (hit.category ? " · " + hit.category : ""), true));
          });
        })
        .catch(function () {});
    })).then(function () { return out; });
  });
}

function seriesStreams(info, season, episode) {
  return searchSt(info.name).then(function (res) {
    var seasons = res.dirs.filter(function (h) {
      if (baseTitle(h.title.replace(/season\s*\d+/i, "")) !== norm(info.name)) return false;
      var sm = h.title.match(/season\s*0*(\d+)|\bS0*(\d+)\b/i);
      var n = sm ? Number(sm[1] || sm[2]) : null;
      return !n || n === Number(season);
    });
    var out = [];
    return seasons.reduce(function (p, hit) {
      return p.then(function () {
        return dirScan(hit.url).then(function (scan) {
          if (!scan) return;
          var files = scan.files.slice();
          return scan.subs.slice(0, 6).reduce(function (q, sub) {
            return q.then(function () { return dirScan(sub.url).then(function (d) { if (d) files = files.concat(d.files); }); });
          }, Promise.resolve()).then(function () {
            files.filter(function (f) { return episodeMatches(f.name, season, episode); })
                 .forEach(function (f) { out.push(makeStream("ShowTime", f.url, f.name, false)); });
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  });
}

function debugStream(info) {
  return { name: "DFLIX", title: "DFLIX - debug | " + (info ? info.name + " (" + info.year + ")" : "no TMDB") + " | " + (DBG.join(" | ") || "no errors"),
           quality: "Unknown", url: "http://127.0.0.1/debug" };
}

function getStreams(tmdbId, mediaType, season, episode) {
  DBG = [];
  var isMovie = mediaType === "movie";
  if (!isMovie && (!season || !episode)) return Promise.resolve([]);
  var info = null;
  return getInfo(tmdbId, mediaType)
    .then(function (i) {
      info = i;
      if (!info.name) return [];
      return isMovie ? movieStreams(info) : seriesStreams(info, season, episode);
    })
    .then(function (out) { return out.length ? out : [debugStream(info)]; })
    .catch(function () { return [debugStream(info)]; });
}

module.exports = { getStreams: getStreams };
