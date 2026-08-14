// 只在 Capacitor 原生壳(iOS App)里生效：网页版没有 window.Capacitor，
// CONTEXTIA_API_BASE 保持空字符串，/api/xxx 继续走相对路径，不受影响。
// 原生壳里静态资源(app.html/app.js/i18n 等)是打包进 App 的本地文件，但 /api/xxx
// 要打到真实后端，所以需要一个绝对地址前缀。
//
// 部署到 Railway 后，把下面这行换成实际域名，然后在 mobile/ 目录跑一次
// `npm run sync:ios` 把新地址同步进 iOS 工程。
const CONTEXTIA_PRODUCTION_API_BASE = "https://contextia.up.railway.app";

window.CONTEXTIA_API_BASE =
  window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    ? CONTEXTIA_PRODUCTION_API_BASE
    : "";
