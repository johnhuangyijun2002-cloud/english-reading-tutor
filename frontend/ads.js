// 广告变现预留接口——目前没有接入任何真实广告 SDK：广告网络还没最终选定，更重要的是，
// 用户当前韩国签证(D-2 留学)下能不能合法收取这类收入还没确认清楚，见 mobile/README.md
// "变现" 一节。这个文件只是留一个统一的调用入口，方便以后确定了广告网络(AdMob/AppLovin/...)
// 之后直接实现，不用改调用方代码，也不用推迟到那时候才设计接口。
//
// 开启方式：
//   1. 把下面 ADS_ENABLED 改成 true
//   2. 在每个方法里补上真实 SDK 调用
//   3. 原生这边还需要：mobile/ios/App/Podfile 加对应 CocoaPods 依赖、Info.plist 加
//      GADApplicationIdentifier / SKAdNetworkItems / NSUserTrackingUsageDescription、
//      走一遍 App Tracking Transparency 授权弹窗、App Store Connect 的 App Privacy
//      问卷要相应更新(声明用了广告/追踪 SDK)——这几步不做的话新 build 会被拒审
//   完整清单见 mobile/README.md。

const ADS_ENABLED = false;

window.ContextiaAds = {
  enabled: ADS_ENABLED,

  // 启动时调用一次；真正接入后在这里做 SDK 初始化(比如 GoogleMobileAds.initialize)
  async init() {
    if (!ADS_ENABLED) return;
  },

  // 展示底部横幅广告；真正接入后在这里创建/展示 banner，并把 #adBannerSlot 从 hidden 里去掉
  showBanner() {
    if (!ADS_ENABLED) return;
  },

  hideBanner() {
    const slot = document.getElementById("adBannerSlot");
    if (slot) slot.classList.add("hidden");
  },
};
