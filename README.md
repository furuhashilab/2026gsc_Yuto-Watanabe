# 航空写真の影から建物の高さを推定する
### PLATEAUを正解とした汎用AI（Claude）の検証 ― 青山学院大学相模原キャンパス周辺を対象として ―（仮題）

**青山学院大学 地球社会共生学部 古橋研究室／2026年度ゼミ論**

> **執筆状況（2026年11月9日時点）**：構想段階から中間発表に向けて更新している草稿です。試行で得た結果と、これから行う計画を区別して書いています（【試行済】【計画】【要確認】）。Claudeによる建物の高さの推定と、PLATEAUとの比較は、まだ行っていません。

- [影の向きの検証（試行）](docs/shadow-direction-validation.md)
- [試行に使ったスクリプト](src/shadow_direction_browser.js)
- [構想発表時点のREADME（FIT認定太陽光発電設備と災害区域の重複分析）](https://github.com/furuhashilab/2026gsc_Yuto-Watanabe/blob/825f846c6a21b58ae996fc20755b88ba9bdbfccb/README.md)
- [見直し案のREADME（淵野辺駅周辺200棟の判別と現地調査）](https://github.com/furuhashilab/2026gsc_Yuto-Watanabe/blob/688dfcb56c5263869c6c94cf33f9d37526453457/README.md)

![影の向きの検証](docs/images/shadow_direction_drone_check.jpg)

## Abstract（概要・暫定）

建物の高さは、延焼のシミュレーションや3D都市モデルの基礎になる情報である。しかし、相模原市のPLATEAUで屋根の形まで表すLOD2は駅前の一部に限られ、OpenStreetMap（OSM）の建物には階数が入っていないものが多い。本研究では、航空写真に写る影と、高さが分かっている数棟の基準建物を手がかりに、汎用の画像対応AI（Claude）が建物の高さをどこまで推定できるかを、PLATEAUの計測高さを正解として検証する。推定には、基準建物との影の長さの比から高さを求める比率法を使う。あわせて、世界規模の建物高さデータGlobalBuildingAtlas（GBA）と同じ正解で比較する。現段階では、研究室のドローン画像を使って、影の向きを全建物で推定する試行を行った。建物1棟ずつの自動推定では妥当な向きは20%にとどまったが、目で確かめた影の向きは撮影時刻から計算した向きと合っていた。この結果から、影の向きは撮影時刻から計算し、建物ごとには影の長さだけを測る方針とした。

**キーワード：** 建物高さ推定、影、航空写真、PLATEAU、OpenStreetMap、GlobalBuildingAtlas、汎用AI（Claude）

---

## 構想発表からの変更点

| 時期 | テーマ | 内容 |
| --- | --- | --- |
| 構想発表 | FIT認定太陽光発電設備と洪水・土砂災害区域の重複分析 | 相模原市の設備と災害区域をGISで重ね、件数と発電出力を集計する |
| 見直し案（2026年11月初め） | 淵野辺駅周辺の建物200棟のAI判別と現地調査 | Claudeが航空写真から用途・階数・屋根の形を判別し、公道からの現地調査と照合する |
| 現在（2026年11月の面談後） | 航空写真の影からの建物の高さ推定 | 現地調査の代わりにPLATEAUの計測高さを正解に使う。正解がそろっているため、対象範囲のすべての建物を評価できる |

「航空写真をAIがどこまで読めるか」という関心は見直し案から引き継いでいる。現在の案では、AIに影という幾何学的な手がかりと基準の高さを与え、数値（m）で評価できる形にした。

---

## I. Introduction（研究背景・目的）

### 1.1 背景

建物の高さは、延焼や浸水のシミュレーション、日照の検討、3D都市モデルの基礎になる。相模原市は延焼シミュレーションに、PLATEAUから取得した階数を使っている（[PLATEAU活用事例資料](https://www.mlit.go.jp/plateau/file/events/doc/2025_2-3_sagamihara.pdf)）。

一方、PLATEAU相模原市（2023年度）で屋根の形まで表すLOD2は、相模原駅・淵野辺駅の駅前（0.97km²）と相模湖駅前（0.1km²）に限られ、それ以外は箱型のLOD1である。OSMの建物には高さの情報が少なく、研究室のドローン画像の範囲にある2,362棟のうち、階数（`building:levels`）が入っているのは361棟（15%）だった【試行済】。

### 1.2 先行研究

| 研究 | 方法 | 本研究との違い |
| --- | --- | --- |
| GlobalBuildingAtlas（Zhu et al., 2025） | 約3mの衛星画像から、専用に訓練した深層学習モデルで世界中の建物の高さを推定。RMSEは世界平均5.5m、アジア5.9m | 影は使っていない。日本単独の精度は示されていない |
| Raju et al.（2014） | 高さが分かっている建物1棟を基準に、影の長さの比で他の建物の高さを推定（比率法）。平均絶対誤差0.67m | 手作業で、検証は約10棟・画像1枚 |
| Chaudhry et al.（2024） | Google Earthの画像で影の長さを測り、高さを計算。RMSE 3.84m | 撮影時刻を正解から逆算し、計算がうまくいった建物だけで評価している |
| GeoHeight-Bench（Hu et al., 2026）、Geo3DVQA（Tsujimoto et al.） | 汎用AIに航空写真の高さに関する質問をさせる評価 | 建物の高さを答える問題の正答率は、GPT-4oで12.2%、Gemini-2.5-Flashで29.8%。Claudeは評価されておらず、基準の高さも与えていない |

### 1.3 研究目的

航空写真に写る影と、高さが分かっている数棟の基準建物を手がかりに、汎用AI（Claude）が建物の高さをどこまで推定できるかを、PLATEAUの計測高さを正解として明らかにする。

### 1.4 リサーチクエスチョン

**主たる問い**：影と基準建物の高さを与えたとき、Claudeは建物の高さをどの程度の誤差（m）で推定できるか。

**補助的な問い**

- 影が測れない建物はどれだけあり、どのような建物か
- 基準建物は何棟あればよいか（1棟・3棟・5棟で比べる）
- Claudeが画像を見て判断する方法（方式A）と、Claudeが影を測るプログラムを作る方法（方式B）で、精度はどう違うか
- GBAの高さと比べて、どちらがPLATEAUに近いか

---

## II. Methods（研究方法）

### 2.1 対象範囲【要確認】

青山学院大学相模原キャンパス周辺とする。具体的な範囲は未定で、研究室のドローン画像の範囲（約1km四方）を第一候補とする。

### 2.2 使用データ

| データ | 内容 | 用途 | 利用条件 | 状況 |
| --- | --- | --- | --- | --- |
| 研究室のドローン画像 | 2021年12月15日 11:30〜12:30撮影、約2.7cm | 影の測定 | OpenAerialMap、CC BY 4.0 | 【試行済】 |
| Bing航空写真（OSMの背景画像） | 撮影日は日付の幅のみ、時刻は不明 | 影の測定（候補） | OSM Wikiでは、OSMの作図以外の利用は許されないとされている | 【要確認】先生に確認するまで使わない |
| 地理院タイルの航空写真 | 約0.5m | 影の測定（候補） | 出典の記載で利用可 | 【計画】 |
| PLATEAU 相模原市（2023年度） | 計測高さ（`bldg:measuredHeight`）、地上階数 | 正解・基準建物 | Project PLATEAUサイトポリシー | 【計画】 |
| OpenStreetMapの建物 | 建物の外形 | 対象建物の一覧と形 | ODbL | 【試行済】 |
| GlobalBuildingAtlas（GBA.LoD1） | 建物ごとの推定高さ | 先行研究との比較 | CC BY-NC 4.0（非営利） | 【計画】 |
| ドローン画像のDSM | 同じ飛行から作られた地表の高さ | 高さの確認（候補） | OpenAerialMap、CC BY 4.0 | 【要確認】 |

### 2.3 高さの推定方法【計画】

基準建物の高さ h₀ と影の長さ L₀、推定したい建物の影の長さ L から、比率法で高さ h を求める。

```text
h = h₀ × L ÷ L₀
```

撮影時刻が分かる画像では、太陽高度 α から `h = L × tan α` でも計算できる。

- **影の向き**：撮影時刻から計算した向きを使い、大きな建物の影の先端や電柱の影など、少数の目印で確かめる（3.2の試行の結果による）。
- **影の長さ**：その向きに沿って、建物の外形から影の先端までを測る。影が他の建物や樹木にかかる建物は「測れない」として数を記録する。
- **基準建物**：PLATEAUの高さを使う。基準以外の建物の正解は推定に使わない。
- **方式A**：画像と基準建物の高さをClaudeに渡し、高さを答えさせる。
- **方式B**：Claudeに影の長さを測るプログラムを作らせ、比率法で計算する。
- 各建物について3回推定し、ばらつきを不確かさとして記録する（GBAの考え方を取り入れる）。

### 2.4 評価方法【計画】

- PLATEAUの計測高さに対する平均絶対誤差（MAE）とRMSE（m）。階数に換算した一致率も補助的に出す。
- 低層・中層・高層の区分ごと、屋根の形ごとに誤差を分ける。PLATEAUの計測高さは建物の最高点、影から分かるのは影を落とす縁の高さで、定義が異なるため。
- 推定できなかった建物（影が測れない、建て替えなど）の数と割合を必ず報告する。
- 同じ建物について、GBAの高さとClaudeの推定を並べて比べる。

### 2.5 Claudeに任せる作業

OSMの建物の取得、画像の読み込み、影の解析、PLATEAU・GBAとの照合、集計はClaudeが行う。結果の目視確認と、手法の判断は筆者が行う。

### 2.6 データの利用条件

- Bing航空写真は、利用してよいか先生に確認するまで、取得も解析もしない。
- 画像そのものはリポジトリに置かず、出典を記載する。
- GBA由来のデータは非営利の条件付きであることを明記する。

---

## III. Results（結果：現時点の進捗）

> **注意：** 本節は2026年11月9日時点の進捗であり、建物の高さを推定した結果ではない。

### 3.1 進捗

| 項目 | 状態 | 内容 |
| --- | --- | --- |
| 先行研究の調査 | 完了 | GBAの論文とGitHub、影を使った研究、汎用AIの評価研究 |
| Bing航空写真の利用条件 | 確認待ち | OSM Wikiの記述を先生に確認する |
| OSMの建物の取得 | 完了 | ドローン画像の範囲で2,362棟 |
| ドローン画像の読み込み | 完了 | 約0.24m/画素で解析 |
| 影の向きの検証 | 試行済 | 3.2を参照 |
| 対象範囲の決定 | 未定 | |
| PLATEAUの内容確認 | 未着手 | 範囲内の棟数、計測高さ・階数が入っている棟数 |
| GBAの取得 | 未着手 | |
| 高さの推定（方式A・B） | 未着手 | |

### 3.2 ドローン画像での影の向きの検証【試行済】

ドローン画像の範囲にあるOSMの建物2,362棟すべてで、影の向きを自動で推定した（[詳細](docs/shadow-direction-validation.md)）。撮影時刻から計算した影の向きは358°〜14°（北を0°として時計回り）、太陽高度は29.9〜31.2°である。

| 区分 | 妥当な範囲（355〜17°）に入った建物 |
| --- | --- |
| 画像の縁から50m以上内側：建物1棟ずつの推定 | 237 / 1,179棟（20%） |
| 同じ範囲：周りの建物を束ねた推定（半径約60m） | 969 / 1,276棟（76%） |
| 画像の縁から50m以内：建物1棟ずつの推定 | 41 / 433棟（9%） |

外れた推定の31%は壁に垂直な向きと一致しており（偶然なら約14%）、建物のすき間の暗い帯を影と取り違えていた。住宅地では影の大部分が隣の家の屋根に落ちる。一方、目で確かめた3か所（D棟の影の先端、公園わきの住宅、道路を横切る電柱の影）は、どれも約10〜15°で、撮影時刻の範囲と合っていた。D棟の影は長さ約32mで、高さに直すと約18〜19mとなり、4階建てと合う。

---

## IV. Discussion（考察：検証前の論点）

### 4.1 影の向きは「測る」より「計算して確かめる」

建物1棟ずつの自動推定は、壁の向きや隣の建物の影に引っぱられ、信頼できなかった。撮影時刻が分かる画像では、影の向きは計算で決め、目印で確かめる方が確実である。撮影の1時間で太陽高度は1.3°しか変わらず、高さの誤差は約5%以内に収まるため、比率法は画像全体で使える。

### 4.2 影が測れない建物

住宅の密集地では、影の多くが隣の建物に落ちる。測れる建物だけで精度を出すと、結果がよく見えすぎる。測れない建物の割合と、その建物の特徴も結果として示す。

### 4.3 新規性（暫定）

- 数棟の基準建物と影を与えた汎用AI（Claude）による、建物ごとの高さ推定と、その定量評価
- 日本の郊外で、GBAと同じ正解（PLATEAU）を使った直接比較
- 基準建物と評価する建物を分け、推定できなかった建物も含めて報告する評価

### 4.4 限界

- 特定のAIモデル・時点・地域での結果である。
- ドローン画像（2021年）とPLATEAU（2023年度）は時期が異なり、建て替えた建物は除外が必要である。
- ドローン画像の撮影時刻は、画像の名前（「1155」）と目で見た影の向きの間にずれがあり、確認が必要である【要確認】。

---

## V. 今後の予定（中間発表まで）

- [ ] Bing航空写真の利用条件を先生に確認する
- [ ] ドローン画像の撮影時刻と、DSMが使えるかを確認する
- [ ] 対象範囲を決める
- [ ] PLATEAU相模原市（2023年度）を入手し、範囲内の棟数と、計測高さ・階数が入っている棟数を確認する
- [ ] 範囲内のGBA.LoD1を入手する
- [ ] 試行：基準3棟＋対象20棟程度で方式Aを試し、PLATEAU・GBAと並べる
- [ ] 中間発表の資料を作る

---

## 参考文献（暫定）

- Zhu, X. X., Chen, S., Zhang, F., Shi, Y., & Wang, Y. (2025). [GlobalBuildingAtlas: an open global and complete dataset of building polygons, heights and LoD1 3D models](https://essd.copernicus.org/articles/17/6647/2025/). *Earth System Science Data*, 17, 6647–6668.（コード：[zhu-xlab/GlobalBuildingAtlas](https://github.com/zhu-xlab/GlobalBuildingAtlas)）
- Raju, P. L. N., Chaudhary, H., & Jha, A. K. (2014). [Shadow Analysis Technique for Extraction of Building Height Using High Resolution Satellite Single Image and Accuracy Assessment](https://isprs-archives.copernicus.org/articles/XL-8/1185/2014/isprsarchives-XL-8-1185-2014.pdf). *ISPRS Archives*, XL-8.
- Chaudhry, S., Qureshi, M., Jabbar, S., & Taj, M. (2024). [Building Height Estimation Using Shadow Length in Satellite Imagery](https://arxiv.org/abs/2411.09411). arXiv:2411.09411.
- Hu, X., Xiong, Z., Hong, Z., Ban, Y., Zhu, X., & Zhao, W. (2026). [GeoHeight-Bench: Towards Height-Aware Multimodal Reasoning in Remote Sensing](https://arxiv.org/abs/2603.25565). arXiv:2603.25565.
- Tsujimoto, M., Wang, J., Xuan, W., & Yokoya, N. [Geo3DVQA: Evaluating Vision-Language Models for 3D Geospatial Reasoning from Aerial Imagery](https://arxiv.org/html/2512.07276v2). arXiv:2512.07276.
- Zhang, C., & Wang, S. (2024). [Good at Captioning, Bad at Counting: Benchmarking GPT-4V on Earth Observation Data](https://openaccess.thecvf.com/content/CVPR2024W/EarthVision/html/Zhang_Good_at_Captioning_Bad_at_Counting_Benchmarking_GPT-4V_on_Earth_CVPRW_2024_paper.html). *CVPR Workshops*, 7839–7849.

**データ・資料**

- [G空間情報センター：3D都市モデル（Project PLATEAU）相模原市（2023年度）](https://www.geospatial.jp/ckan/dataset/plateau-14150-sagamihara-shi-2023)
- [PLATEAU標準仕様：計測高さ（bldg:measuredHeight）](https://www.mlit.go.jp/plateaudocument02/tocC/tocC_03/tocC_03_02/tocC_03_02_03)
- [PLATEAU活用事例資料（相模原市）](https://www.mlit.go.jp/plateau/file/events/doc/2025_2-3_sagamihara.pdf)
- [OpenStreetMap Wiki: Bing Maps](https://wiki.openstreetmap.org/wiki/Bing_Maps)
- [OpenAerialMap](https://map.openaerialmap.org/)：sagamihara20211215aoyamauniv1155mapconcierge00arw01（CrisisMappersJapan/DRONEBIRD/FuruhashiLab/YouthMappersAGU、CC BY 4.0）
- [国土地理院：地理院地図の地上画素寸法](https://www.gsi.go.jp/gazochosa/gazochosa41015.html)
- [古橋研究室 卒論・ゼミ論ルール](https://github.com/furuhashilab/README/issues/5)

---

## ライセンス

本リポジトリに掲載する研究文章及び著者が作成した図表は、
Creative Commons Attribution 4.0 International（CC BY 4.0）
の下で提供します。

本リポジトリに掲載する自作プログラムは、
MIT Licenseの下で提供します。

ただし、国土交通省（PLATEAU）、国土地理院、OpenStreetMap、OpenAerialMap、GlobalBuildingAtlas等から取得した
第三者データには、それぞれの提供元が定める利用規約が適用されます。
第三者データの権利を本ライセンスによって許諾するものではありません。

図（docs/images）には、OpenAerialMapのドローン画像（CrisisMappersJapan/DRONEBIRD/FuruhashiLab/YouthMappersAGU、CC BY 4.0）と、OpenStreetMapの建物（© OpenStreetMap contributors、ODbL）を使用しています。
