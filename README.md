# BOSS｜把能力變成作品

一個部署在 GitHub Pages 的個人能力作業系統，把音樂、繪畫、程式、外語與人脈放進同一個每日入口。

「程式」能力另有 GitHub 作品牆：每日同步帳號的公開、非 fork repository，並以人工校準的中文用途、分類與字章圖示整理展示。

公開網站：<https://xieyaozhong.github.io/BOSS/>

## 它每天做什麼

- 從五項能力中選出一條「今日主線」
- 把可用時間拆成界定範圍、做出主體、收尾保存三步
- 強制指定一個有明確完成條件的最小產出
- 安排一個短維持練習，避免其他能力完全掉線
- 加上一個不要求姓名與聯絡資料的人脈小步
- 公開基準依能力差距、優先權與五日輪替生成；個人化層再加入練習空窗與近七日完成平衡
- 主線、維持練習與人脈小步的合計時間不超過每日預算
- 依目前／目標程度、實際難度與可用時間，選出能在今天完成的產出尺度
- 同步 GitHub 公開作品的語言、更新時間與封存狀態；新 repository 會先進入待校準，避免誤把內部或未完成內容放大公開

預設每天台北時間 **06:17** 由 GitHub Actions 重新產生並部署，**06:47** 再做一次等冪補跑，降低排程偶發延誤的影響。規則引擎不需要 API 金鑰，也不會產生費用。

## 第一次使用

1. 打開網站後按「校準能力」。
2. 填入目前會的具體技能、近期方向、每天可用時間，以及五項能力的目前／目標程度。
3. 完成任務後按「完成並留下證據」，記錄時間、作品連結與一句反思。
4. 定期使用「匯出備份」保存個人紀錄。

初始程度刻意標成「待校準」，不會假裝知道使用者的真實能力。

## 三層自動化

1. **公開基準層**：`scripts/generate_daily.py` 每天在 GitHub Actions 內產生 `today.json`，並直接部署 Pages artifact。
2. **個人適應層**：瀏覽器會依校準資料與完成紀錄重新計算當天建議；資料保存在 `localStorage`，不會被發佈到公開 repo。
3. **作品同步層**：`scripts/generate_projects.py` 在建置時讀取 GitHub 公開 repository，合併 `config/project-overrides.json` 的中文用途與圖示後產生靜態作品目錄；瀏覽器不會直接呼叫 GitHub API。

因此，不同裝置會看到同一個公開基準，但只有已校準的瀏覽器會有個人化紀錄。可以透過匯出／匯入 JSON 在裝置間搬移能力、主線產出與維持／人脈勾選紀錄；單筆產出也能從頁面刪除。

## 隱私

這個 repository 與 GitHub Pages 都是公開的：

- 不要把姓名、Email、電話、私人訊息或 API key 寫進 `site/data/`。
- 人脈功能預設只要求匿名行動，例如「完成一次資源分享」；完成表單仍是自由文字，請勿自行填入他人個資。
- 完成紀錄與反思預設只保存在瀏覽器，但 `localStorage` 以網域而非 `/BOSS/` 路徑隔離，同一個 `xieyaozhong.github.io` 網域下的其他頁面理論上也能讀取。
- 匯出的備份可能包含私人反思，請自行妥善保管。
- 「校準能力」視窗提供「清除 BOSS 本機資料」，只移除本網站使用的四個儲存鍵。

## 調整公開基準

編輯 [`site/data/profile.json`](site/data/profile.json) 可以調整五項能力的：

- 起始程度、目標與優先權
- 近期方向與下一個里程碑
- 練習題庫與合理產出題庫
- 跨領域產出與人脈小步

修改後執行：

```bash
python scripts/generate_daily.py
python scripts/generate_projects.py
python -m unittest discover -s tests -v
python scripts/validate_site.py
python -m http.server 4173 --directory site
```

然後開啟 <http://localhost:4173/>。

GitHub 作品用途、顯示名稱、分類、字章與限制說明集中在 [`config/project-overrides.json`](config/project-overrides.json)。新 repository 會被每日偵測，但預設要在這裡補上一句用途後才會公開，避免誤收錄測試或敏感專案；如果明確希望未校準作品直接顯示，可將 `publishUncurated` 改成 `true`，屆時會使用 GitHub description 或中性說明作為備援。

## 自動部署

工作流程位於 [`.github/workflows/daily-pages.yml`](.github/workflows/daily-pages.yml)，支援：

- 推送 `site/`、`config/`、`scripts/` 或 workflow 變更時部署
- 每天主排程與補跑排程
- pull request 只驗證、不部署；部署任務只允許 `main`
- 從 Actions 頁面手動執行

排程工作流程可能因平台負載稍晚執行；公開 repository 若長期沒有活動，GitHub 也可能暫停排程，屆時手動重新啟用即可。現有成功版本在新的驗證或部署失敗時會繼續在線。

## 技術設計

- 純 HTML、CSS、JavaScript，沒有前端框架或執行階段依賴
- Python 3 標準函式庫規則引擎
- GitHub REST API 建置時同步；前端只讀取已驗證的本機 JSON
- GitHub Actions + GitHub Pages artifact deployment
- 相對資源路徑，支援 `/BOSS/` project site
- 完成紀錄與個人設定使用瀏覽器 localStorage
- 建置時檢查時間預算、完成條件、缺漏資源與公開資料敏感欄位

GitHub 平台行為可參考 [Pages 自訂工作流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 與 [排程事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
