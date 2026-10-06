# TIẾP TỤC DỰ ÁN — MissAV → Nuvio

Bắt đầu: 2026-09-28. Repo: https://github.com/chuongnguyen89dn-ui/missav
Render: https://missav-uimx.onrender.com/ — service srv-dasvard9fdbs73f9f0dg, workspace tài khoản anhchuong3dn@gmail.com. Dự án độc lập, KHÔNG sửa XemXiec.

## Mốc thành công đã xác nhận — 28/09/2026

**Phim mẫu FTHTD-213 phát được trên Nuvio, kể cả chế độ DIRECT không truyền video qua Render.** Người dùng trực tiếp xác nhận “được play ngon lành” cho cả proxy và DIRECT. Đây là mốc chuẩn bắt buộc giữ khi mở rộng toàn site.

1. Surrit gốc: `surrit.com` trả HTTP 403 khi Render lấy playlist, dù có Referer. Nuvio mở nguồn gốc cũng lỗi 403; không kết luận chắc nguyên nhân là IP vì chưa xác minh quy tắc chặn.
2. Host dự phòng `surrit.mrstcdn.store` với cùng đường dẫn phim trả playlist HLS HTTP 200, `playlistValid=true` từ Render.
3. Kiểm tra media entry đầu tiên từ host dự phòng: HTTP 200, nhận 883.976 bytes, content-type `image/jpeg` (không dùng MIME để suy diễn video hỏng); playlist kiểm tra không có EXT-X-KEY. Chỉ kiểm tra một entry, không đại diện toàn bộ site.
4. Proxy Render `/mirror/1080p/video.m3u8` viết lại URL playlist/segment về proxy, đã phát thực tế trên Nuvio; **nhưng truyền dữ liệu video qua Render, không dùng làm mặc định khi cần tiết kiệm free quota**.
5. Commit `2d7e6419f8243a635e29306e0ef654bcca27f7ec` thêm stream `Mirror 1080p · DIRECT · no Render bandwidth`, URL trực tiếp đến host dự phòng với behaviorHints request headers. Người dùng xác nhận phát ngon trên Nuvio. DIRECT: Nuvio tải playlist/segment từ host dự phòng, Render chỉ trả manifest/catalog/meta/stream JSON.
6. Render deploy `dep-dasvqbrbc2fs73ak1aeg` của commit `2d7e641` trạng thái LIVE, ứng dụng nghe port 10000. Trong truy vấn log sau deploy, request log trả về rỗng, app log không ghi lỗi runtime; **chưa có số liệu băng thông thực đo, không khẳng định quota bằng 0**.

## Các commit quan trọng
- `444b4d0`: endpoint `/diagnose.json` trả JSON upstream.
- `03b8344`: `/diagnose-mirrors.json` so sánh host gốc/dự phòng.
- `43ba6a6`: proxy host dự phòng + `/diagnose-mirror-segments.json`.
- `2d7e641`: thêm DIRECT không đi qua Render, đã được xác nhận phát.

## Quy tắc bất biến khi phát triển tiếp
- Giữ FTHTD-213 và stream DIRECT đã thành công làm regression test; không sửa mất playback khi thêm crawler/catalog.
- Ưu tiên URL trực tiếp host dự phòng theo từng phim. **Không được lấy UUID của FTHTD-213 gán cho phim khác**; phải trích URL thực của từng trang phim, kiểm tra playlist/segment khi cần.
- Không đặt proxy video Render làm stream mặc định. Nếu DIRECT không hoạt động cho phim khác, báo đúng trạng thái; không âm thầm chuyển sang proxy tiêu tốn băng thông.
- Chỉ quét danh sách/metadata/URL có giới hạn, phân trang, cache, incremental update; không tải video về Render, không quét ồ ạt.
- Không đưa token hoặc URL có token vào log công khai; không suy diễn 200 playlist đồng nghĩa phát được Nuvio.
- Sau mỗi sửa: kiểm tra build/deploy/runtime logs, xác minh rồi mới báo xong. XemXiec độc lập.

## Trạng thái và việc kế tiếp
Hiện `server.js` vẫn là addon thử nghiệm một phim, chưa có catalog toàn site, search, pagination, metadata extractor hay crawler. README cũ còn mô tả trạng thái ban đầu, cần đồng bộ khi triển khai.

Thứ tự: (1) tìm hiểu cấu trúc trang và trích mã/poster/metadata từ nhiều phim; (2) lấy HLS thực của từng phim, kiểm tra DIRECT trên Nuvio với vài phim; (3) catalog/search/pagination; (4) incremental scanner có giới hạn request/cache, theo dõi Render Free. Chỉ mở rộng khi không làm hỏng mốc DIRECT.

## 28/09/2026 — Chuẩn bị bộ lấy link (chưa tích hợp runtime)
Đã tạo `scripts/extract-links.mjs`, `scripts/README.md` và `test/extract-links.test.js`. CLI nhận URL trang phim hoặc HTML lưu sẵn, xuất JSON gồm code, metadata, playlist/media candidates, UUID và giả thuyết mirror; tùy chọn `--probe` chỉ kiểm tra playlist tối đa 8 URL. Không tải video, không proxy qua Render và chưa bật quét toàn site. Không kết luận URL candidate phát được cho đến khi kiểm tra thực tế. Các file này không thay đổi `server.js` hoặc playback FTHTD-213. Cần chạy test và kiểm tra kết quả với HTML thực trước khi dùng làm crawler.

## Quy định chất lượng — 1080p ONLY
Chỉ lấy và hiển thị link 1080p. Bỏ 720p, 480p và các chất lượng khác; không tự hạ chất lượng khi 1080p thiếu hoặc lỗi. Master playlist chưa xác định rendition không được đưa vào danh sách phát. Bộ trích xuất đã thêm bộ lọc URL 1080p; các playlist master cần bước phân tích rendition riêng sau này nếu muốn tìm nhánh 1080p. Không thay đổi playback mẫu đang Live.


# CẬP NHẬT BÀN GIAO — AV01 Hottest full-site scanner — 06/10/2026

> Phần này là trạng thái hiện hành. Khi tiếp tục dự án phải đọc phần này trước các ghi chú AV01 cũ.

## 1. Bộ scanner hiện hành — phải giữ nguyên để tiếp tục
- Scanner chính: `scripts/av01_hottest_filtered_proven.py`.
- Launcher Windows/CMD: `SCAN-AV01-FULL.cmd`.
- Hotkey helper: `scripts/test_hotkey.ps1`; `Ctrl+Alt+F9` ẩn/hiện cửa sổ CMD nhưng scanner vẫn chạy.
- Output/checkpoint dùng thư mục `av01_hottest_full`. Không xóa thư mục/checkpoint khi muốn resume.
- Catalog được publish lên GitHub: `data/av01-catalog.json`.
- Nguồn duy nhất của đợt clean scan này: `https://www.av01.media/en/videos/hottest`.
- Run clean hiện hành: `av01-clean-en-hottest-20261005`. Không merge/import kết quả AV01 cũ vào run này.

Lệnh chạy chuẩn từ CMD ở repo:
```cmd
git pull
SCAN-AV01-FULL.cmd
```
Launcher gọi Python với `--count 0 --out av01_hottest_full`, nghĩa là quét toàn site thay vì giới hạn số phim.

## 2. Cách scanner hoạt động
1. Mở Hottest bằng browser/Playwright thật để có context/cookie hợp lệ; không dựa vào direct API bên ngoài browser vì AV01 từng trả 429.
2. Danh sách Hottest dùng API trong browser context: `/api/v1/videos/types/hottest?page=N&limit=20`. API thực tế đã xác nhận page 1 có `include_facets=true`; các trang sau dùng page/limit.
3. Scanner duyệt candidate, mở detail, lấy metadata chính thức, năm, tag, poster/JSON-LD và dữ liệu cần cho resolver.
4. Năm được nhận: **2024, 2025, 2026**.
5. Preferred tags chỉ để ưu tiên/ranking, **KHÔNG phải điều kiện bắt buộc**: Big Tits, Big Boobs, Large Breasts, Huge Breasts, Huge Tits, Huge Boobs, Busty, Big Breasts, Beautiful Tits; nhận alias `Ngực khủng` khi site trả tiếng Việt.
6. Hard exclude nếu có một trong các tag: Toy, Sex Toys, Dildo, Anal, Cross Dressing, Lesbian, Gay, Shemale, Transsexual, Mature, 熟女, Mother, MILF; `Máy bay bà già` phải coi tương đương Mature và loại.
7. Mỗi phim phải resolve nguồn phát và xác minh chất lượng thực >=1080p; không chỉ tin label 1080p.
8. Không chấp nhận trùng ID/phim. Metadata/tag thiếu tạm thời phải WAIT/retry, không publish record chưa đủ.
9. Resolver chạy song song tối đa 10 worker. Khi gặp 429, job chờ/retry riêng với backoff 15/30/... tối đa 120 giây mỗi lần; không coi 429 là hết site.
10. Cứ đủ **20 phim đạt chuẩn** scanner cập nhật `data/av01-catalog.json` và commit/push một batch lên GitHub. Scanner tiếp tục chạy sau khi publish.
11. Checkpoint lưu tiến độ để crash/stop có thể resume, tránh làm lại detail/resolve cho các ID đã được đánh dấu processed. Các mục metadata transient chưa hoàn tất được phép retry.
12. Khi hết danh sách và resolver queue hoàn tất thì scanner mới kết thúc bình thường.

## 3. Cơ chế phân trang và lỗi đã sửa
Đã từng bị kẹt vô hạn tại page 9 với log dạng `page=9 items=20 merged=176`. Nguyên nhân: page được tính lại từ `current_count // 20 + 1`, nên khi page trả toàn item trùng và merged không tăng thì scanner gọi lại đúng page 9 mãi.

Commit `84d3f38caa30ecb2070f231b89ea7486ccddc351` sửa bằng cursor `next_api_page` độc lập:
- Mỗi HTTP 200 thành công thì tăng page kể cả item trả về bị trùng.
- Chỉ coi danh sách hết khi response thành công có ít hơn 20 item.
- 429/network error không được đánh dấu end-of-site; retry cùng page.

Lưu ý kỹ thuật còn phải theo dõi: nếu AV01 clamp page vượt cuối và liên tục trả lại 20 item cũ, cursor page vẫn tăng. Khi tiếp tục phát triển nên bổ sung fingerprint/no-growth guard để phát hiện cùng một tập ID bị lặp nhiều trang; không được kết luận scanner hiện tại miễn nhiễm 100% với mọi kiểu loop phía server.

## 4. Watchdog / tự phục hồi
Commit `9d81678eac5778e36d6db83febff94d4a66cb1f3` thêm heartbeat + watchdog:
- Ghi `heartbeat.json` khoảng mỗi 30 giây.
- Theo dõi next index, số candidates, accepted, processed, resolver/API state.
- Nếu không có tiến triển 300 giây: save checkpoint, ghi trạng thái `watchdog_restart`, thoát code 75.

Commit `bdbb1e9a0443a9310405375c03399879467156b1` làm `SCAN-AV01-FULL.cmd` tự chạy lại scanner sau 15 giây khi Python thoát non-zero. Scanner mới đọc checkpoint và tiếp tục. Hotkey helper chỉ được khởi động trước vòng `:RUN`, nên watchdog restart không cố ý tạo helper mới mỗi vòng.

Cảnh báo: launcher hiện restart với **mọi non-zero exit**, không chỉ code 75. Nếu người dùng chủ động Ctrl+C mà Python trả non-zero, batch có thể chạy lại; muốn dừng hẳn thì đóng CMD/stop batch trong khoảng chờ restart. Watchdog cũng không thể ngắt ngay một lời gọi browser bị treo bên trong cho tới khi lời gọi đó trả/timeout.

## 5. Cơ chế AV01 1080 đã chứng minh
Luồng đã xác nhận dùng được:
`AV01 page -> kích hoạt player/browser network -> capture /api/v1/videos/<id>/manifest/master.m3u8 -> chọn rendition sv3 1920x1080 -> lấy cdn-access/token hiện hành -> rewrite playlist -> HLS/fMP4`.

Mốc test cũ: ID 221078/IPZZ-967 cho thấy master có sv1=360p, sv2=720p, sv3=1920x1080. fMP4 cần `?access_token=<TOKEN>`; thiếu/sai token từng trả 403. Token có thể hết hạn/gắn session/IP nên phải resolve tại thời điểm phát, không lưu token cũ làm URL vĩnh viễn. Script lịch sử đã phát thành công: `av01_export_1080_direct.py`.

## 6. Parser code phim
API Hottest có nhiều slug chung như `lada`, `lada-av-debut`, vì vậy không được lấy slug URL làm code phim một cách mù quáng.
- Commit `c361fbe908fd6062be7f2a3abced8536cff5c1ba`: parser ưu tiên regex code thật từ title.
- Commit `9040f93401f25d54c1a3a9fe4f23ffd29fb5d334`: sửa 8 code của batch đầu.
- Vẫn còn record mới có code parse chưa chuẩn (ví dụ title chứa code thật nhưng field code có thể còn `LADA`/chuỗi sai). Người dùng đã quyết định **để scanner chạy xong rồi sửa code toàn bộ một lượt**, không dừng scanner vì việc này.

## 7. Trạng thái dữ liệu tại thời điểm bàn giao
- GitHub đã publish **300 phim verified**.
- Commit batch mới nhất tại thời điểm ghi: `828759f93de1053ec25887c544828fe32eee9b7f` — `data(av01): publish verified batch through 300 movies`.
- Các batch gần nhất trước đó: 220, 240, 260, 280 rồi 300; mỗi batch tăng 20 phim đúng cơ chế publish.
- Không coi 300 là tổng cuối cùng của site; scanner còn có thể tiếp tục publish batch mới.

## 8. Addon Nuvio / active runtime
Process entry của repo là `node --import ./javhd-test-hook.js server.js`. **`javhd-test-hook.js` đang intercept các route AV01 và /manifest.json trước server.js**, nên khi sửa catalog/manifest AV01 phải kiểm tra hook này; trước đây sửa riêng manifest trong server.js không làm Nuvio thay đổi.

Manifest active đã được thêm catalog thứ 4:
- `MissAV · Verified 1080p`
- `ikisoda`
- `Test AV01`
- `AV01 · Hottest · Filtered 1080p`

Commit đúng để thêm filtered catalog vào active hook: `0cbd9dbb53071c9db6dde2108c98d70e6e72b815`. User đã xác nhận catalog mới xuất hiện trong Nuvio. Stream route `av01:<id>` dùng native AV01 runtime/token động và đã có log phát 200 cho các ID filtered như 221350, 221277, 221343.

Render service addon thực tế:
- service: `missav`
- service id: `srv-dasvard9fdbs73f9f0dg`
- URL: `https://missav-uimx.onrender.com`
- workspace: `tea-dari1417lnhs73dfqf90`.

Ngày 06/10/2026 đã trigger deploy commit 300 phim `828759f` lên service này, deploy id `dep-db20p6jtqb8s73bl0kb0`. Tại thời điểm trigger nó ở `build_in_progress`; phải kiểm tra Render chuyển `live` trước khi khẳng định addon đang phục vụ đủ 300 phim.

## 9. Poster/metadata — để xử lý SAU khi full scan hoàn tất
Catalog hiện có metadata như ID, code, title, description, year, official tags, page URL và JSON-LD. JSON-LD AV01 có thể chứa thumbnailUrl, uploadDate/datePublished, duration, contentUrl, actor, creator/maker.

Poster hiện là việc chưa chốt. Signed `files.iw01.xyz/covers/<id>/800.webp?...token...` có expiry/IP. JSON-LD có thumbnail ổn định dạng `https://www.av01.media/media/videos/tmb/<id>/1.jpg`.

Đã thử commit `6b68689c1d99e06cd819e8560f2aab0c9938cada` proxy poster qua Render (`/av01/<id>/poster.jpg`), nhưng người dùng **không muốn poster/video ảnh làm tốn tài nguyên Render**. Vì vậy khi xử lý sau scan phải ưu tiên direct/static poster; không giữ proxy Render làm giải pháp mặc định nếu có cách direct hoạt động.

Sau khi scanner quét xong, thứ tự cleanup đã thống nhất:
1. Chuẩn hóa/sửa toàn bộ code phim sai từ title/metadata.
2. Bổ sung/chuẩn hóa metadata (release date, duration, actress/cast, maker/studio, official tags và link tag/actor nếu có).
3. Chốt poster direct/static hoạt động trong Nuvio, tránh Render bandwidth.
4. Kiểm tra duplicate và record metadata lỗi.
5. Kiểm tra catalog/meta/stream trong Nuvio và playback 1080 thực tế.
6. Khi catalog mới đã xác nhận ổn mới cân nhắc xóa `Test AV01`; hiện chưa được xóa chỉ vì filtered catalog đã xuất hiện.

## 10. Nguyên tắc khi tiếp tục
- Không viết lại scanner từ đầu nếu chưa có lý do kỹ thuật rõ ràng; tiếp tục từ các script/commit trên.
- Không xóa checkpoint/output của full scan.
- Không đổi filter preferred thành mandatory.
- Không đổi hard-exclude nếu chưa có yêu cầu mới.
- Không coi 429 là end-of-site.
- Không dùng code/slug sai làm ID logic; ID số AV01 là khóa ổn định hơn.
- Không đưa token tạm thời vào catalog như URL vĩnh viễn.
- Không proxy poster/video qua Render làm mặc định nếu mục tiêu có thể đạt bằng direct URL.
- Mọi deploy phải kiểm tra trạng thái Render/log trước khi báo live.
- Sau khi full scan xong mới làm đợt sửa code + metadata + poster tổng thể như đã thống nhất.
