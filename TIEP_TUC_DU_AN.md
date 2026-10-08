# TIẾP TỤC DỰ ÁN — AV01 Hottest Scanner

## 0. TRẠNG THÁI CHUẨN

**ĐÂY LÀ BẢN SCANNER AV01 THÀNH CÔNG NHẤT HIỆN TẠI. KHÔNG VIẾT LẠI TỪ ĐẦU.**

- Repo: `chuongnguyen89dn-ui/missav`
- Branch: `main`
- Script chính: `scripts/av01_hottest_filtered_proven.py`
- Launcher Windows: `SCAN-AV01-FULL.cmd`
- Helper publish checkpoint: `scripts/publish_av01_checkpoint_all.py`
- Code tham khảo resolver đã pass: `scripts/av01-vlc-proof.mjs`
- Commit quyết định của resolver: `c909ebd14e3729474389e789677271bf12c86627` — `fix(av01): use proven geo cdn-access token flow`
- Nguồn quét: `https://www.av01.media/en/videos/hottest`
- Catalog: `data/av01-catalog.json`
- Checkpoint local: `av01_hottest_full/checkpoint.json`
- Phiên thành công đã tăng catalog từ 446 lên ít nhất 700 phim verified.

Mục tiêu của tài liệu này là để một phiên làm việc mới có thể dựng lại, chạy, sửa, tiếp tục và publish scanner **từ đầu đến cuối** mà không phải đoán lại cách làm.

---

# 1. KIẾN TRÚC HOẠT ĐỘNG

Scanner thực hiện tuần tự:

1. Mở trang Hottest bằng Chromium/Playwright.
2. Lấy danh sách phim và tiếp tục pagination qua API Hottest.
3. Mở detail từng phim để lấy official tags + metadata.
4. Chỉ nhận năm 2024/2025/2026.
5. Loại phim có hard-block tags.
6. Lấy AV01 CDN access token trực tiếp, không phụ thuộc click player.
7. Lấy manifest sv3 1080p.
8. Rewrite/sign các object CDN bằng access token.
9. Probe nguồn thật.
10. Chỉ ACCEPT khi probe thành công `200/200`.
11. Ghi checkpoint liên tục.
12. Lỗi tạm thời đưa vào pending để retry.
13. Đủ batch thì cập nhật `data/av01-catalog.json`, commit và push GitHub.
14. Quét đến khi Hottest hết và pending hết.

Dấu hiệu resolver đang hoạt động đúng:

```text
DIRECT TOKEN OK
RESOLVE QUEUED
DONE <count> <code> OK 200/200
```

---

# 2. FLOW TOKEN THÀNH CÔNG — KHÔNG ĐƯỢC THAY BẰNG CƠ CHẾ CLICK PLAYER

Đây là phần quan trọng nhất.

### Bước 1 — lấy thông tin geo

GET:

```text
https://files.iw01.xyz/edge/geo.js?json
```

Lấy:

- `token_v2`
- `expires`
- `ip`

### Bước 2 — xin CDN access token

GET:

```text
https://customers.iw01.xyz/api/v1/videos/<VIDEO_ID>/cdn-access
```

Query:

```text
token_v2=<token_v2>
expires=<expires>
ip=<ip>
```

Kết quả cần:

```text
access_token
```

### Bước 3 — manifest 1080

```text
https://www.av01.media/api/v1/videos/<VIDEO_ID>/manifest/index90-sv3-v1-a1.m3u8
```

### Bước 4 — ký playlist

Mọi URL object thuộc `iw01.xyz` phải được rewrite/sign với:

```text
?access_token=<ACCESS_TOKEN>
```

Nếu có `ro` thì giữ/thêm `ro`.

### Bước 5 — xác minh thật

Probe các object đầu tiên. Chỉ ACCEPT khi:

```text
OK 200/200
```

Không được coi nhãn 1080p trên giao diện là bằng chứng phim phát được.

---

# 3. QUY TẮC LỌC

### Năm

Chấp nhận:

- 2024
- 2025
- 2026

### Preferred tags

Các tag sau chỉ là **ưu tiên/xếp hạng**, KHÔNG phải điều kiện bắt buộc:

- Big Tits
- Big Boobs
- Large Breasts
- Huge Breasts
- Huge Tits
- Huge Boobs
- Busty
- Big Breasts
- Beautiful Tits
- Ngực khủng nếu AV01 trả tag tiếng Việt tương ứng

### Hard block

Loại nếu official tags chứa:

- Toy
- Sex Toys
- Dildo
- Anal
- Cross Dressing
- Lesbian
- Gay
- Shemale
- Transsexual / Transgender
- Mature
- Mother
- MILF
- các alias tiếng Việt tương ứng như Máy bay bà già/Mature

Không lọc bằng suy đoán từ poster.

---

# 4. TẠO REPO / ĐƯA SCRIPT LÊN GITHUB TỪ ĐẦU

Nếu repo chưa tồn tại, tạo repository trên GitHub trước. Repo hiện tại đã tồn tại nên phần dưới chủ yếu dùng khi dựng lại trên máy mới.

## 4.1 Clone repo về Windows

Mở **CMD**:

```cmd
cd /d C:\Users\Trinh\Downloads
git clone https://github.com/chuongnguyen89dn-ui/missav.git
cd /d C:\Users\Trinh\Downloads\missav
```

Nếu repo đã có sẵn:

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
```

## 4.2 Cấu trúc file bắt buộc

```text
missav/
├─ scripts/
│  ├─ av01_hottest_filtered_proven.py
│  ├─ av01-vlc-proof.mjs
│  ├─ publish_av01_checkpoint_all.py
│  └─ test_hotkey.ps1
├─ data/
│  └─ av01-catalog.json
├─ SCAN-AV01-FULL.cmd
└─ TIEP_TUC_DU_AN.md
```

Script chuẩn phải nằm đúng tại:

```text
scripts/av01_hottest_filtered_proven.py
```

Không tạo scanner mới ở tên khác nếu chỉ đang sửa scanner hiện tại.

---

# 5. CÀI MÔI TRƯỜNG TRÊN MÁY MỚI

Kiểm tra Python:

```cmd
python --version
```

Kiểm tra Git:

```cmd
git --version
```

Cài dependency Python:

```cmd
python -m pip install requests playwright
python -m playwright install chromium
```

Kiểm tra script compile:

```cmd
python -m py_compile scripts\av01_hottest_filtered_proven.py
```

Nếu lệnh compile không báo lỗi thì mới chạy scanner.

---

# 6. CÁCH CHẠY SCANNER TỪ ĐẦU ĐẾN CUỐI

## 6.1 Chạy/resume bình thường

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
python -m py_compile scripts\av01_hottest_filtered_proven.py
SCAN-AV01-FULL.cmd
```

Launcher gọi scanner với chế độ full-site và thư mục checkpoint `av01_hottest_full`.

Ctrl+Alt+F9: ẩn/hiện CMD nhưng scanner vẫn chạy.

## 6.2 Chạy Python trực tiếp nếu cần debug

```cmd
cd /d C:\Users\Trinh\Downloads\missav
python scripts\av01_hottest_filtered_proven.py --count 0 --out av01_hottest_full
```

`--count 0` nghĩa là quét toàn bộ Hottest.

## 6.3 Resume

Không xóa:

```text
av01_hottest_full/checkpoint.json
```

Chỉ chạy lại:

```cmd
SCAN-AV01-FULL.cmd
```

Scanner đọc checkpoint và tiếp tục.

## 6.4 Clean run thật sự

**Chỉ làm khi có chủ ý bỏ checkpoint cũ.** Dừng scanner trước, sau đó đổi tên thư mục checkpoint để vẫn giữ bản sao:

```cmd
cd /d C:\Users\Trinh\Downloads\missav
ren av01_hottest_full av01_hottest_full_backup
SCAN-AV01-FULL.cmd
```

Không clean run khi scanner đang chạy tốt.

---

# 7. CÁCH SCANNER TỰ ĐƯA PHIM LÊN GITHUB

Khi đạt ngưỡng publish, hàm `publish_batch()`:

1. Ghi phim verified vào `data/av01-catalog.json`.
2. `git add data/av01-catalog.json`
3. Tạo commit dạng:

```text
data(av01): publish verified batch through <N> movies
```

4. `git push origin main`

Ví dụ commit đã thành công:

```text
data(av01): publish verified batch through 700 movies
```

Muốn publish toàn bộ accepted đang có trong checkpoint:

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
python -m py_compile scripts\publish_av01_checkpoint_all.py
python scripts\publish_av01_checkpoint_all.py
```

Không deploy Render tự động chỉ vì catalog vừa push, trừ khi có yêu cầu deploy.

---

# 8. CÁCH TẠO / SỬA SCRIPT VÀ PUSH LÊN GITHUB

## 8.1 Trước khi sửa

Luôn cập nhật repo:

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
git status
```

Đọc:

- `scripts/av01_hottest_filtered_proven.py`
- `scripts/av01-vlc-proof.mjs`
- `TIEP_TUC_DU_AN.md`
- các commit gần nhất liên quan AV01

## 8.2 Sau khi sửa Python

Compile:

```cmd
python -m py_compile scripts\av01_hottest_filtered_proven.py
```

Xem thay đổi:

```cmd
git diff -- scripts\av01_hottest_filtered_proven.py
git status
```

## 8.3 Commit

```cmd
git add scripts\av01_hottest_filtered_proven.py
git commit -m "fix(av01): mô tả chính xác thay đổi"
```

## 8.4 Push

```cmd
git push origin main
```

## 8.5 Xác minh

```cmd
git status
git log -1 --oneline
```

Sau đó chỉ restart scanner nếu thay đổi thực sự cần được nạp vào process đang chạy.

---

# 9. CÁCH SỬA SCRIPT TRỰC TIẾP QUA GITHUB CONNECTOR / API

Nếu ChatGPT hoặc công cụ có quyền ghi GitHub:

1. Fetch file hiện tại và lấy **blob SHA hiện tại**.
2. Sửa trên nội dung file hiện tại, không dựng lại từ trí nhớ.
3. Gửi **toàn bộ nội dung file mới** cùng blob SHA vào thao tác update file.
4. Commit thẳng lên `main` với message rõ ràng.
5. Fetch lại file/commit để xác nhận write thành công.
6. Máy Windows đang chạy repo phải `git pull` để nhận code mới.
7. Compile trước khi restart scanner.

Điểm quan trọng: GitHub update file cần SHA của phiên bản đang tồn tại. Nếu file đã thay đổi sau lúc fetch, phải fetch lại SHA rồi mới update; không ghi đè mù.

---

# 10. NGUYÊN TẮC SỬA CODE — BẮT BUỘC

1. Đọc code hiện tại và lịch sử trước.
2. Chỉ sửa phần cần sửa.
3. Không rewrite toàn scanner khi pipeline đang chạy.
4. Không bỏ direct geo/cdn-access token flow.
5. Không quay lại cơ chế click player làm nguồn token chính.
6. Giữ sv3 1080 manifest.
7. Giữ rewrite/sign playlist.
8. Giữ probe 200/200.
9. Giữ checkpoint/resume.
10. Giữ pending retry cho lỗi tạm thời.
11. Giữ watchdog.
12. Giữ pagination toàn Hottest.
13. Giữ publish catalog lên GitHub.
14. Không để poster/metadata cleanup làm chậm pass xác minh stream.
15. Không restart scanner đang chạy tốt chỉ để áp dụng thay đổi không cấp thiết.
16. Không báo thành công nếu chưa có log hoặc commit chứng minh.

---

# 11. LỖI TẠM THỜI VÀ PENDING

Các lỗi như:

- HTTP 429
- metadata chưa hydrate
- token tạm lỗi
- 504
- probe/open timeout
- mất mạng

không được đánh dấu FAIL vĩnh viễn.

Phải:

1. lưu checkpoint;
2. đưa item vào pending;
3. tiếp tục phim khác;
4. retry pending sau;
5. không để một phim lỗi chặn toàn bộ scanner.

---

# 12. WATCHDOG / MẤT MẠNG / KHỞI ĐỘNG LẠI

`SCAN-AV01-FULL.cmd` chạy scanner trong vòng lặp watchdog.

Nếu scanner thoát non-zero, launcher chờ rồi chạy lại từ checkpoint.

Nếu scanner phát hiện không có tiến triển trong khoảng watchdog, nó lưu checkpoint rồi thoát với mã lỗi để launcher restart.

Vì vậy **không xóa checkpoint khi lỗi**.

---

# 13. POSTER / METADATA

Pass quét chính ưu tiên:

```text
find -> filter -> direct token -> 1080 -> probe -> accepted
```

Không tải poster trong pass này.

Sau khi scan xong mới làm pass metadata/poster:

- sửa code/title sai;
- lấy description;
- release/year;
- duration;
- actresses;
- maker/studio;
- official tags + tag id/href;
- stable poster.

ID số AV01 là khóa chính để không mất liên kết dù code/title parse chưa đẹp.

---

# 14. RENDER / ADDON

Catalog addon:

```text
data/av01-catalog.json
```

GitHub có phim mới **không đồng nghĩa Render đang dùng catalog mới**, vì addon hiện load catalog khi process khởi động.

Do đó:

- Scanner có thể tiếp tục push GitHub.
- Không deploy Render giữa lúc quét nếu chưa được yêu cầu.
- Khi cần đưa catalog mới live, deploy/restart service Render sau.

---

# 15. QUY TRÌNH KHÔI PHỤC TRÊN MÁY MỚI — COPY NGUYÊN KHỐI NÀY

```cmd
cd /d C:\Users\Trinh\Downloads
git clone https://github.com/chuongnguyen89dn-ui/missav.git
cd /d C:\Users\Trinh\Downloads\missav
python -m pip install requests playwright
python -m playwright install chromium
python -m py_compile scripts\av01_hottest_filtered_proven.py
SCAN-AV01-FULL.cmd
```

Nếu repo đã clone:

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
python -m py_compile scripts\av01_hottest_filtered_proven.py
SCAN-AV01-FULL.cmd
```

---

# 16. CHECKLIST TRƯỚC KHI NÓI “ĐÃ THÀNH CÔNG”

Phải có ít nhất một trong các bằng chứng sau, tùy việc đang kiểm tra:

- log `DIRECT TOKEN OK`;
- log `DONE ... OK 200/200`;
- accepted count tăng trong checkpoint;
- commit `data(av01): publish verified batch through N movies`;
- `data/av01-catalog.json` tăng count.

Không dựa vào việc script “không crash” để kết luận thành công.

---

# 17. ĐIỂM BẮT ĐẦU CHO PHIÊN LÀM VIỆC SAU

Khi được yêu cầu **“tiếp tục dự án AV01”**:

1. Đọc file này.
2. Đọc `scripts/av01_hottest_filtered_proven.py`.
3. Kiểm tra các commit AV01 mới nhất.
4. Kiểm tra `data/av01-catalog.json`.
5. Nếu scanner đang chạy tốt thì không can thiệp.
6. Nếu phải sửa resolver, tham khảo `scripts/av01-vlc-proof.mjs`.
7. Bảo toàn direct-token baseline của commit `c909ebd`.

**Không quay lại các scanner cũ đã thất bại.**


---

# CẬP NHẬT 2026-10-07 — HAI PIPELINE AV01 CHẠY SONG SONG

## A. PIPELINE QUÉT LINK / FULL CATALOG — BẢN ĐANG DÙNG

Đây là pipeline đã tạo và publish catalog hiện tại **2120 phim**. Không thay bằng workflow test 20 cũ.

- Scanner chính: `scripts/av01_hottest_filtered_proven.py`
- Launcher full scan Windows: `SCAN-AV01-FULL.cmd`
- Launcher liên quan: `scan-av01-hottest-20.cmd` (hiện gọi cùng scanner với `--count 0`)
- Checkpoint local: `av01_hottest_full/checkpoint.json`
- Publisher: `scripts/publish_av01_checkpoint_all.py`
- Catalog publish: `data/av01-catalog.json`
- Nguồn: `https://www.av01.media/en/videos/hottest`
- Catalog GitHub đã xác nhận ngày 2026-10-07: **2120 phim**
- Commit publish mốc 2120: `cf078dff92644619c98bd5f500dc44391c03607c`

Luồng:
`SCAN-AV01-FULL.cmd` -> `scripts/av01_hottest_filtered_proven.py` -> `av01_hottest_full/checkpoint.json` -> `scripts/publish_av01_checkpoint_all.py` -> `data/av01-catalog.json`.

`SCAN-AV01-FULL.cmd` chạy:
```bat
python scripts\av01_hottest_filtered_proven.py --count 0 --out av01_hottest_full
```
Nếu scanner lỗi, launcher chờ 15 giây rồi chạy lại từ checkpoint.

**CẢNH BÁO:** Không chạy nhầm `.github/workflows/av01-scan.yml` để tiếp tục full scan. Workflow đó xóa `data/av01-progress.json` và `data/av01-catalog.json`, sau đó chạy scanner Node theo batch 20; có nguy cơ thay catalog 2120 bằng catalog test nhỏ.

## B. PIPELINE METADATA / POSTER — TEST ĐÚNG 20 PHIM ĐẦU

Pipeline này độc lập với full scanner và chạy song song. Nó không được thay/reset `data/av01-catalog.json`.

- Dữ liệu enrichment test: `data/av01-addon-test20.json`
- Số record: **20**
- Đã đối chiếu ngày 2026-10-07: **20/20 ID khớp chính xác 20 record đầu tiên của `data/av01-catalog.json`**.
- Metadata/thông tin lấy theo AV01.
- Poster DMM khi có.
- Nếu không có poster phù hợp thì để trống, không ép poster sai.
- 15/20 record hiện có poster DMM; 5 record không có poster trong bộ test hiện tại.
- Commit tạo dữ liệu 20 phim: `a3c2683de0ffe76209324b1c54b99b3bd1047ec4`
- Commit tích hợp metadata: `456ade71918013d0f22c86a3662d274c0a37ef58`

20 ID đầu đã xác nhận:
`221350, 221415, 221418, 221277, 221343, 221374, 221417, 221331, 221416, 221442, 221441, 221373, 221344, 221107, 221341, 221267, 221335, 221100, 221082, 221435`.

Các code đầu tương ứng gồm `YUJ-074`, `NPJS-284`, `NPJS-278`, `CAWB-040`, `ADN-793`, `SIRO-5739`, `NPJB-131`, `JBD-313`, `NPJS-281`, `390JNT-125`, `200GANA-3463`, `300MIUM-1452` và các record LADA tiếp theo.

## C. CÁCH GHÉP ADDON — KHÔNG ĐƯỢC NHẦM 20 VỚI 2120

- Catalog chính luôn là `data/av01-catalog.json` = 2120 phim tại mốc hiện tại.
- `data/av01-addon-test20.json` chỉ là lớp metadata/poster enrichment cho 20 phim đầu.
- Ghép theo `id`: chỉ override metadata/poster cho ID trùng.
- Không prepend một bộ 20 độc lập.
- Không tạo addon/manifest AV01 thứ hai.
- Catalog addon hiện tại: `av01-filtered` / tên `AV01 · Hottest · Filtered 1080p`.
- Commit sửa merge đúng kiến trúc: `e2f3b2ddda2f0a4b1de5c0b1dc78c6c702a8308b`.

Hai pipeline phải tiếp tục **song song**:
1. Full scanner tiếp tục quét/verify/publish số lượng phim.
2. Metadata/poster enrichment tiếp tục làm thông tin cho các ID từ chính catalog scanner.


---

# CẬP NHẬT 2026-10-08 — METADATA CHO TOÀN BỘ 2120 ID

**Yêu cầu đã chốt:** Mỗi 20 phim metadata hoàn thành thì tự động commit/push GitHub một lần. **Chỉ khi chủ dự án yêu cầu mới đưa metadata lên add-on/Render.** Không tự deploy hoặc thay đổi manifest.

- Script: `scripts/av01_enrich_catalog_ids.py`
- Launcher watchdog: `SCAN-AV01-METADATA.cmd`
- Đầu vào bất biến: `data/av01-catalog.json` (2120 phim ở thời điểm lập kế hoạch)
- Checkpoint local: `av01_metadata_full/checkpoint.json`
- Heartbeat local: `av01_metadata_full/heartbeat.json`
- File publish metadata riêng: `data/av01-metadata-enriched.json`
- Chạy trên Windows từ thư mục repo: `SCAN-AV01-METADATA.cmd`
- Debug tối đa 20 ID (không push): `python scripts\\av01_enrich_catalog_ids.py --limit 20`
- Chạy full và push mỗi 20 ID thành công: `python scripts\\av01_enrich_catalog_ids.py --publish`

**Resume:** checkpoint lưu `done` theo ID và `pending` cho lỗi. Restart bỏ qua ID thành công, retry ID lỗi khi hết thời gian chờ. Checkpoint được ghi bằng file tạm rồi replace để tránh file JSON ghi dở. Heartbeat báo tiến độ. Watchdog thoát mã 75 nếu không có thành công mới trong 300 giây; launcher khởi động lại sau 15 giây. Lỗi metadata tạm thời retry sau 180–900 giây. Không xóa checkpoint.

**Publish:** Khi có đủ 20 ID thành công mới kể từ mốc đã push, script tạo metadata-only JSON và `git add/commit/push` file này lên main. Mốc `published` chỉ tăng sau khi push thành công. Nếu mạng/GitHub lỗi, launcher restart và thử publish lại. Cần bảo đảm máy chạy có Git và quyền push. Dữ liệu HLS, token, playlist và catalog gốc không được ghi đè.

**Giới hạn cần kiểm thử:** Mới cập nhật code, chưa có log chạy thật 20 phim để xác nhận HTML selectors và dữ liệu diễn viên/hãng. Cần test 20 ID đầu trước full run. Poster lấy từ og:image của AV01, chưa tái hiện đối chiếu DMM như bộ test cũ; không được tự tuyên bố 15/20 poster DMM với script mới. Script chưa tự động cập nhật add-on. Không khởi chạy workflow `.github/workflows/av01-scan.yml` vì workflow này có thể reset catalog.

**Lưu ý:** Publish chỉ khi có `--publish`. Nếu chạy thử `--limit 20` thì chỉ tạo checkpoint và JSON local, không push. Sau khi kiểm tra chất lượng mới dùng launcher chạy full.


---

# CẬP NHẬT BẮT BUỘC 2026-10-08 — LƯU ĐẦY ĐỦ 2 SCANNER ĐANG DÙNG

> Đính chính bàn giao trước: script metadata/poster KHÔNG bị mất. Script đang tồn tại trên branch main là `scripts/av01_enrich_catalog_ids.py`. Khi tiếp tục dự án phải dùng đúng các file dưới đây, không tự viết lại từ trí nhớ.

## 1. SCANNER LINK/HLS — FULL AV01 CATALOG

### File chính
- `scripts/av01_hottest_filtered_proven.py`
- Launcher Windows: `SCAN-AV01-FULL.cmd`
- Publisher toàn checkpoint: `scripts/publish_av01_checkpoint_all.py`

### Lệnh chạy chuẩn
```bat
SCAN-AV01-FULL.cmd
```

Tương đương gọi trực tiếp:
```bat
python scripts\av01_hottest_filtered_proven.py --count 0 --out av01_hottest_full
```

Publish toàn bộ accepted trong checkpoint:
```bat
python scripts\publish_av01_checkpoint_all.py
```

### Dữ liệu
- Nguồn: `https://www.av01.media/en/videos/hottest`
- Checkpoint: `av01_hottest_full/checkpoint.json`
- Heartbeat: `av01_hottest_full/heartbeat.json`
- Catalog publish: `data/av01-catalog.json`
- Mốc catalog đã xác nhận: **2120 phim**.

### Flow chính
Hottest -> pagination API -> detail từng ID -> official tags -> lọc năm 2024/2025/2026 -> hard-block tag -> geo.js -> cdn-access -> access_token -> sv3 1080p -> sign iw01.xyz -> probe 200/200 -> checkpoint -> publish GitHub.

### Quy tắc quan trọng
- Không reset `data/av01-catalog.json` khi tiếp tục scan.
- Không dùng workflow test batch 20 để thay full scanner.
- Resolver chuẩn là direct token `geo.js -> cdn-access`, không quay lại cơ chế click player cũ.
- Chỉ accepted khi probe nguồn thành công.
- Scanner có checkpoint/watchdog; launcher tự restart sau lỗi và tiếp tục checkpoint.

## 2. SCANNER METADATA + POSTER — CHẠY SONG SONG VỚI SCANNER LINK

### File chính
`scripts/av01_enrich_catalog_ids.py`

Đây là script thật đang tồn tại trên branch `main`, không phải script phục dựng.

### Lệnh chạy toàn catalog và publish mỗi 20 ID hoàn tất
```bat
python scripts\av01_enrich_catalog_ids.py --publish
```

### Lệnh test 20 lượt
```bat
python scripts\av01_enrich_catalog_ids.py --limit 20
```

Nếu muốn test 20 và đồng thời bật publish:
```bat
python scripts\av01_enrich_catalog_ids.py --limit 20 --publish
```

### Input / output / trạng thái
- Input: `data/av01-catalog.json`
- Output metadata layer: `data/av01-metadata-enriched.json`
- Checkpoint: `av01_metadata_full/checkpoint.json`
- Heartbeat: `av01_metadata_full/heartbeat.json`
- Mặc định delay: 1.5 giây.
- `--limit 0` = chạy toàn bộ ID.
- `--publish` = commit/push output theo batch 20 newly completed IDs; không deploy addon.

### Metadata script lấy
- title
- description
- official tags
- official tag refs
- actresses
- maker
- poster DMM/FANZA đã kiểm tra theo code.

### Quy tắc poster DMM
- Không dùng poster AV01 tokenized/expiring làm nguồn poster enrichment.
- Lấy code từ `movie.code` hoặc title.
- Code regex hiện tại: prefix chữ 2–8 ký tự + phần số 2–6 chữ số.
- Search DMM/FANZA theo code.
- Chỉ nhận kết quả có code khớp.
- Chỉ nhận URL ảnh HTTPS thuộc `pics.dmm.co.jp`.
- Actress được dedupe theo actress ID/URL.

### Hành vi checkpoint hiện tại RẤT QUAN TRỌNG
Khi khởi động, script chỉ giữ record `done` nếu:
1. ID vẫn còn trong catalog filtered hiện tại; và
2. record có poster không rỗng.

Do đó **record metadata không tìm được poster DMM sẽ bị loại khỏi done và được quét lại ở lần chạy sau**. Đây là hành vi hiện tại của commit `662b87f40fdf50cdebf4a78b436e00388882d181`; không được nhầm là scanner bị mất checkpoint.

### Lịch sử commit quan trọng của scanner metadata/poster
- `988613022a11f7855d854940dab41827fef8bc8d` — tạo `scripts/av01_enrich_catalog_ids.py`: enrichment theo toàn bộ ID catalog, checkpoint và output riêng.
- `f8c9cceeced51cc90e23d1afd30863a74493fd43` — DMM-only verified-code poster lookup, bỏ AV01 expiring poster, dedupe actresses.
- `4a06aae396b907fc1c8ec9b93c5edc85dda167bb` — sửa DMM code regex và poster URL validation.
- `4e8962b34bfee5e6bfaf14fc8b75ba4803984c94` — sửa regex phần số để thực sự match digits.
- `662b87f40fdf50cdebf4a78b436e00388882d181` — record thiếu poster được coi chưa hoàn chỉnh và quét lại.

### Bộ test 20 phim cũ để đối chứng
- Output test: `data/av01-addon-test20.json`
- 20/20 ID đã đối chiếu khớp 20 phim đầu catalog tại thời điểm test.
- Mốc test có 15/20 poster DMM.
- Commit dữ liệu test: `a3c2683de0ffe76209324b1c54b99b3bd1047ec4`.
- Commit addon dùng enrichment: `456ade71918013d0f22c86a3662d274c0a37ef58`.

## 3. QUY TẮC KIẾN TRÚC — KHÔNG TRỘN HAI SCANNER

### Scanner A — LINK/HLS
```text
scripts/av01_hottest_filtered_proven.py
  -> av01_hottest_full/checkpoint.json
  -> data/av01-catalog.json
```

### Scanner B — METADATA/POSTER
```text
data/av01-catalog.json
  -> scripts/av01_enrich_catalog_ids.py
  -> av01_metadata_full/checkpoint.json
  -> data/av01-metadata-enriched.json
```

Scanner metadata chỉ enrich theo ID đã có trong catalog scanner. Nó không được thay thế, reset hoặc khôi phục phim đã bị scanner link/filter loại.

## 4. LỆNH KIỂM TRA NHANH KHI MỞ PHIÊN MỚI

```bat
git status
git log -10 --oneline
python scripts\av01_enrich_catalog_ids.py --help
```

Đối với scanner link:
```bat
SCAN-AV01-FULL.cmd
```

Đối với metadata/poster:
```bat
python scripts\av01_enrich_catalog_ids.py --publish
```

Không được tuyên bố script metadata bị mất nếu chưa kiểm tra `scripts/av01_enrich_catalog_ids.py` và lịch sử các commit nêu trên.


## 2026-10-08 — BÀN GIAO NHÓM POSTER, BỘ LỌC VÀ CÁC VẤN ĐỀ CHƯA XONG

- Nguồn dữ liệu đã kiểm tra: `data/av01-metadata-enriched.json`, tổng 1678 phim; 1430 có URL poster, 248 thiếu URL poster. Trong 248: 83 mã FC2-PPV, 165 bản ghi `movie_code` rỗng. Có URL không đồng nghĩa ảnh đúng: DMM có thể trả ảnh placeholder, hoặc đường dẫn cần tiền tố riêng.
- Trong 165 bản ghi thiếu mã: phân nhóm nhanh từ `catalog_title` tìm được SPSF (20), MURIKURI (5), T38 (2), CPZ69 (1), còn 137 không khớp biểu thức phân loại đơn giản; một số chỉ có tiêu đề mặc định AV01. Đây là số liệu phân loại sơ bộ, không phải bằng chứng 137 phim không có mã trên AV01.
- Năm MURIKURI đang thiếu mã và poster trong metadata: MURIKURI-018 (AV01 221311), MURIKURI-017 (221310), MURIKURI-014 (214255), MURIKURI-013 (214254), MURIKURI-012 (210646). Người dùng cung cấp mẫu URL DMM `https://pics.dmm.co.jp/mono/movie/adult/1murikuri018/1murikuri018pl.jpg` và `https://pics.dmm.co.jp/mono/movie/adult/1murikuri017/1murikuri017pl.jpg`. Quy tắc chỉ cho MURIKURI: bỏ dấu gạch nối, viết thường, thêm số 1 phía trước stem DMM cho cả thư mục và tên ảnh. Ba mã còn lại phải kiểm tra URL/ảnh thực tế trước khi coi là đã xác minh.
- ĐÃ SỬA `scripts/av01_enrich_catalog_ids.py`: hàm `dmm_cover` thêm `1` trước stem chỉ khi prefix là MURIKURI; commit `4cd70108dccb097f5b3925d5162a1ceec2d1b9ff`. Hàm `movie_code` mở rộng nhận diện prefix 2–8 chữ và số hậu tố 2–6 chữ số để nhận diện MURIKURI; commit `4dfd66b1885bbbd77e8917474eda58cfefb754cb`. Chưa chạy lại enrichment, chưa xác minh 5 poster đã được ghi trong JSON hoặc hiện trên addon.
- SPSF: người dùng yêu cầu XÓA toàn bộ phim SPSF khỏi GitHub catalog, metadata và add-on, đồng thời chặn ngay từ scanner LINK/HLS để các lần quét sau không lấy lại. 20 mã SPSF được tìm trong metadata: SPSF-04, SPSF-30, SPSF-38 đến 51, SPSF-53, SPSF-55, SPSF-56, SPSF-58. Mẫu DMM SPSF-04 người dùng cung cấp là `h_173spsf04/h_173spsf04pl.jpg`, nhưng nhóm này KHÔNG ĐƯỢC GIỮ LẠI theo yêu cầu mới. Thao tác xóa catalog/metadata trước đó bị công cụ từ chối, nên CHƯA XÓA, CHƯA CẬP NHẬT ADD-ON, CHƯA THÊM BỘ LỌC SPSF. Cần sửa scanner link `scripts/av01_hottest_filtered_proven.py`, lọc cả đầu vào lẫn dữ liệu xuất, cập nhật catalog và metadata, kiểm tra Render sau deploy. Không được tuyên bố hoàn thành trước khi xác minh.
- Các mẫu thuộc 137 bản ghi có tiêu đề mặc định: AV01 220428, 220908, 220427, 221249, 220158. Người dùng nói một phim mẫu có mã HMN-904, nhưng dữ liệu GitHub gắn HMN-904 và poster `https://pics.dmm.co.jp/mono/movie/adult/hmn904/hmn904pl.jpg` cho AV01 220392, còn 220428 đang trống; cần đối chiếu trang AV01 để tránh gán nhầm hai ID.
- Hai trường hợp đường dẫn DMM có tiền tố đặc biệt khác: KV-329: `h_955kv329/h_955kv329pl.jpg`; JERA-052: `1jera052/1jera052pl.jpg`. Không áp dụng quy luật MURIKURI cho tất cả phim.
- KIẾN TRÚC: scanner link/HLS và scanner metadata/poster là hai luồng riêng, không được trộn. Metadata chạy theo `data/av01-catalog.json`, checkpoint `av01_metadata_full/checkpoint.json`, xuất `data/av01-metadata-enriched.json`; có thể chạy `python scripts\\av01_enrich_catalog_ids.py --publish` khi được yêu cầu. Không dùng `--restart-all` khi muốn giữ checkpoint. Không tự deploy add-on khi chỉ yêu cầu cập nhật metadata.


### 2026-10-08 — Bốn poster trắng người dùng xác nhận
- NACT-194, AV01 221405: metadata ghi `movie_code=NACT-194`, `poster=https://pics.dmm.co.jp/mono/movie/adult/nact194/nact194pl.jpg`, `poster_status=verified_dmm`; người dùng báo poster trắng. Chưa tìm được URL thay thế đáng tin cậy.
- THZA-10, AV01 221440: `catalog_title` bắt đầu `THZA-10`, nhưng `movie_code` bị nhận sai thành `VOL-110` từ chuỗi `Vol.110` trong tiêu đề; poster hiện `/vol110/vol110pl.jpg` và bị đánh dấu `verified_dmm`. Cần ưu tiên mã ở đầu catalog_title, tránh lấy mã giả từ mô tả; xác minh poster THZA-10 riêng.
- JERA-052, AV01 221308: poster lưu sai `/jera052/jera052pl.jpg`; đường dẫn đúng người dùng cung cấp trước đó `/1jera052/1jera052pl.jpg`.
- KV-329, AV01 221419: poster lưu sai `/kv329/kv329pl.jpg`; đường dẫn đúng người dùng cung cấp trước đó `/h_955kv329/h_955kv329pl.jpg`.
- Không thể coi HTTP 200 và image/jpeg là xác minh poster thật; `verified_dmm` hiện chứa false positives. Phải xác minh nội dung ảnh, tìm nguồn đúng và cập nhật metadata. Tránh áp dụng một tiền tố cho tất cả các mã. Chưa xác nhận sửa trực tuyến 4 poster này.
