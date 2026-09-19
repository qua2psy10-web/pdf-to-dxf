# TRACE — PDF to DXF

PDF図面のベクトル線・曲線・文字を、編集可能なDXFに変換します。

**公開版: https://qua2psy10-web.github.io/pdf-to-dxf/**

公開版はインストール不要で、別のPCや外部ネットワークから利用できます。
PDFの読込・変換・保存は利用者のブラウザ内で行います。選択したPDFをサーバーに送信しません。
ページを配信するGitHubへのアクセスは発生しますが、PDF本文やファイル名の送信、解析用の外部API、広告・アクセス解析はありません。
PDFはタブ内のメモリに保持し、ブラウザの永続ストレージには保存しません。

最新版のChrome・Edge・Firefox・Safariを使用してください。大きなPDFの処理能力は端末のメモリ・CPUに依存します。
公開版もスキャン画像の自動トレースには対応していません。

## 公開版とローカル版

| 項目 | 公開版（GitHub Pages） | ローカル版（Python） |
| --- | --- | --- |
| PDF処理 | PDF.js + ブラウザ内Web Worker | PyMuPDF + ezdxf |
| 利用方法 | 公開URLを開く | 起動.command |
| Pythonのインストール | 不要 | 必要 |
| 直線・曲線 | LINE / SPLINE | LINE / LWPOLYLINE / SPLINE |
| 文字 | 日本語TEXT、黒色・代替フォント | 日本語TEXT、文字色保持・代替フォント |
| 線幅 | CADの既定値 | PDF線幅から近似 |
| 不可視文字があるページ | ページの文字抽出を省略 | 可視文字のみ抽出 |
| 保存 | 単一DXF / 全ページZIP | 単一DXF / 全ページZIP |

公開版は1ファイル50MB・200ページ・1ページ30万要素、ZIPは展開後合計100MBまでです。
画像、元のCADレイヤー・寸法オブジェクト、注釈、ハッチは復元しません。クリッピングや透明度は完全には再現しません。

## Web版の開発と公開

Node.js 24以上を推奨します。

```sh
npm ci
npm test
npm run build
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist
```

`http://127.0.0.1:8766` で確認できます。公開されるファイルは `dist/` 内だけです。
PDF.js・日本語CMap・標準フォント・WASM・使用ライブラリのライセンスを同じサイトから配信し、CDNは使いません。

`.github/workflows/pages.yml` が `main` へのプッシュ時にテスト・ビルド・GitHub Pagesへの公開を行います。
リポジトリの Settings → Pages → Build and deployment は **GitHub Actions** に設定します。
Pull Requestではテストとビルドのみ実行し、公開しません。
この公開版は一般公開です。ブラウザ内の見かけだけのパスワード保護は実装していません。

以下はPythonローカル版の説明です。APIキーは不要です。

## 起動

Finderから **`起動.command` をダブルクリック**してください。ブラウザで <http://127.0.0.1:8765> が開きます。
初回起動時に、このフォルダ内へ仮想環境を作成し、必要なライブラリを自動インストールします。
ターミナルを閉じるか、Control + C で終了します。起動中の再実行は、既存のTRACE画面を開きます。

別の環境ではPython 3.10以上が必要です。初回のみライブラリのインストールにインターネット接続を使います。
ポート8765が他のアプリで使用中の場合は、ターミナルで次を実行します。

```sh
TRACE_PORT=8766 .venv/bin/python run.py
```

## 使い方

1. PDFをドロップするか「ファイルを選択」を押します。「サンプル図面を試す」で動作を確認できます。
2. プレビューのページを選択します。
3. 図面の縮尺を指定します。1:100の図面なら「100」、用紙サイズそのままなら「1」です。
4. 必要に応じて「文字を含める」「線の色を保持」を切り替えます。
5. 「DXF」タブで出力要素のプレビューを確認します。
6. 「DXFを書き出す」で保存します。全ページを選ぶと、ページ別DXFと変換結果JSONをZIPにまとめます。

保存先はブラウザのダウンロード設定に従います。通常は `~/Downloads` です。
元のPDFを上書きしません。ページごとに原点を用紙の左下とし、DXFの単位をmmに設定します。

## 変換内容

| PDFの要素 | DXFの要素・扱い |
| --- | --- |
| 直線 | LINE |
| 四角形・四辺形 | 閉じたLWPOLYLINE |
| 3次ベジェ曲線 | 制御点とノットを保持したSPLINE |
| 円・円弧 | PDFのベジェ曲線をSPLINEとして保持（円への再推定なし） |
| 文字 | Unicode TEXT、位置・方向・文字列幅を保持。代替フォント |
| 色 | True Color。保持をオフにするとByLayer |
| 破線 | PDFの破線パターンをDXF線種へ変換。開始位相は未対応 |
| 線幅 | 用紙上の線幅をDXF標準線幅の最寄り値に変換 |
| 塗りつぶし | 輪郭のみ。ハッチ・マスク・白抜きは未対応 |

出力形式はDXF R2010 / UTF-8です。`PDF_LINES`、`PDF_TEXT`、`PDF_FILL_OUTLINES` に分類します。
換算式は `PDF座標(pt) × 25.4 / 72 × 縮尺分母` です。ページ回転とCropBoxに対応します。

## 対応範囲と制限

- **CAD等から出力したベクトルPDFが対象です。スキャン図面の自動トレース・OCRは未実装です。** 画像と線が混在するPDFでは、画像部分を省略して警告を表示します。
- PDFはCADの情報をすべて持っていません。元のレイヤー、寸法オブジェクト、ブロック、拘束条件、3D情報は復元できません。
- 文字の外形化されたPDFでは文字も線・曲線になります。文字としての編集はできません。
- 字体・文字高さ・縦書き・文字間隔は完全一致しません。CAD側で日本語対応フォントを設定してください。
- クリッピング（切り抜き）や描画順による隠蔽、透明度、白い塗りつぶし、注釈、フォームは完全には再現しません。用紙外の線がDXFに含まれる場合があります。
- プレビューは実際のDXF要素から作った簡易SVGです。線幅やフォントを含む最終表示は使用するCADソフトで確認してください。
- PDF作成時に「用紙に合わせる」などで倍率が変わった場合は、図面の記載縮尺と実際の縮尺が一致しません。既知の寸法をCADで測定して補正してください。
- 1ファイル50MB、200ページ、1ページ30万出力要素まで。複雑なPDFでは処理に時間がかかります。ZIP出力は変換できないページをスキップし、理由を `変換結果.json` に残します。
- PDFは最大8件・合計200MBをメモリに保持します。1時間後は再読込が必要です。期限切れは次の操作で削除され、サーバー終了ですべて消えます。
- サーバーは `127.0.0.1` にのみ接続を許可します。外部公開用サーバーではありません。

## コマンドライン

```sh
.venv/bin/python converter.py "入力.pdf" "output/図面_p1.dxf" --page 1 --scale 100
.venv/bin/python converter.py "入力.pdf" "output/線のみ.dxf" --scale 50 --no-text --monochrome
```

## 検証

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
node --check static/app.js
npm ci
npm test
npm run build
```

21件の自動テストで、座標・単位、4方向回転、CropBox、曲線制御点、日本語、文字除外、色、破線、閉じたパス、塗りつぶしの暗黙の閉合、スキャンPDF、暗号化PDF、不正な入力、ローカルアクセス制限、期限切れ、ZIPを検証しています。
出力DXFをezdxfで再読込し、構造の監査を行います。
付属サンプル2ページ目の検証線は用紙上90mmです。縮尺100なら9,000mm、50なら4,500mmになります。
実際の業務PDFと利用先CADでの互換性は、対象ファイルを使って別途照合してください。
Web版は9件のJavaScriptテストを追加しています。Node依存関係がある場合、PythonテストでもWeb版DXFを実際に生成し、回転・CropBox・曲線・日本語・DXF構造を照合します（Python全22件）。

## 構成

- `converter.py`: 変換エンジン・DXF要素プレビュー・CLI
- `app.py`: PDF受取・ページ情報・プレビュー・DXF/ZIP配信
- `static/`: 日本語の操作画面
- `run.py` / `起動.command`: 起動用
- `examples/サンプル図面.pdf`: 実際に変換できる2ページのPDF
- `tests/`: 変換とAPIの回帰テスト
- `design/concept.png` / `design/spec.md`: 画面デザイン案と仕様
- `web/`: ブラウザ内変換エンジン・ローカル処理アダプター・変換Worker
- `scripts/build-web.mjs`: 既存画面を再利用した静的サイトのビルド
- `.github/workflows/pages.yml`: 自動テスト・GitHub Pages公開

使用ライブラリの仕様: [PyMuPDFの図形抽出](https://pymupdf.readthedocs.io/en/latest/recipes-drawing-and-graphics.html)、[ページ座標・回転](https://pymupdf.readthedocs.io/en/latest/page.html)、[ezdxf](https://ezdxf.readthedocs.io/en/stable/)。
