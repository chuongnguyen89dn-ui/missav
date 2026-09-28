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
