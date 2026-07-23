# 设计约定

## 图标：禁止使用 emoji

UI 里任何地方需要图标、图形提示——导航栏、按钮、状态提示（成功/失败/警告）、空状态、加载中、弹窗标题、卡片图标等等——一律使用线条图标，**不允许直接写 emoji 字符**（📖 ✏️ 🔍 ⭐ ✅ ❌ 🎯 💡 这一类）。i18n 文案（`frontend/i18n/*.json`）里的文案本身也不能夹带 emoji。

这条规则也适用于纯文字说明文档（README、这个文件本身），emoji 不应该出现在项目里的任何地方。Markdown 里正常的排版符号（比如用 `→` 表示"然后点开哪里"这种箭头）不算在内，不用改。

### 具体做法

- 图标素材来自 [lucide](https://lucide.dev/)（线条图标库）的原始 SVG，通过 `npm install lucide-static` 拿到 `node_modules/lucide-static/icons/*.svg` 原始文件里的 `<path>`/`<circle>` 等标签，直接内嵌成 `<svg>` 标签用，不要凭记忆手画图标、也不要引入 `lucide-react`——这个项目没有 React，也没有任何前端构建工具（`frontend/` 就是纯 HTML/CSS/JS，FastAPI 直接当静态文件托管），装了也用不上，反而要多背一整套构建链。
- JS 里动态生成的图标，统一从 `frontend/app.js` 顶部的 `ICON_PATHS` 表里取，用 `iconHTML("图标名")` 生成，不要在业务代码里散落写 SVG 字符串。新图标现在没有的话，去 `lucide-static` 的 `icons/` 目录里挑一个语义相近的，加进 `ICON_PATHS`。
- 静态写在 `index.html` 里的图标（比如侧边栏导航），保持跟 `ICON_PATHS` 里一样的属性：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`，颜色用 `currentColor`，不要写死颜色值——这样图标会自动跟着所在元素的文字颜色走（比如导航项选中态变蓝，图标也跟着变蓝）。
- 尺寸：导航栏这类独立图标 16-20px，按钮/文字行内的小图标 14-16px，统一用 `.inline-icon`（在 `style.css` 里）这个类名，不要每处单独定义尺寸。
- 如果一个位置往 `.textContent` 里塞用户输入拼出来的字符串（比如划词划句选中的原文），**不能**直接改成 `.innerHTML` 加图标——用户选中的文本可能包含尖括号之类的字符，直接塞进 innerHTML 是 XSS 风险。正确做法是先用 `innerHTML` 设置图标（图标本身是写死、可信的），再用 `.append(纯文本)` 把用户内容当文本节点追加进去，参考 `frontend/app.js` 里 `saveAnnotation` 函数的写法。
- `<select><option>` 原生控件不支持内嵌图标（浏览器只会把它当纯文本渲染），这种位置就不放图标，不用勉强。
