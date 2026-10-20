from io import BytesIO
from pathlib import Path

from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from PIL import Image, ImageOps

from app.core.logger import get_logger

# 获取当前模块的专属日志记录器，用于打印当前文件产生的日志
logger = get_logger(__name__)

# 定义缩略图的最大宽度（像素），超过此宽度会被等比缩放，防止图片过大
_THUMBNAIL_MAX_WIDTH = 900

# 定义编码为 WebP 格式时的图片质量（0-100），82 是一个清晰度与体积平衡的推荐值
_THUMBNAIL_QUALITY = 82

# 定义用户手动上传缩略图时允许的图片格式后缀集合
_MANUAL_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

# 定义手动上传图片允许的最大总像素数（4000万），防止“解压炸弹”导致服务器内存溢出
_MANUAL_MAX_PIXELS = 40_000_000

# 声明一个模块级的全局变量，用于缓存 Docling 转换器实例（单例模式），初始为 None
_converter: DocumentConverter | None = None


# 定义获取 Docling 转换器实例的内部函数
def _get_converter() -> DocumentConverter:
    # 声明接下来要修改的是全局变量 _converter
    global _converter

    # 如果转换器还未初始化（第一次调用该函数）
    if _converter is None:
        # 创建 PDF 处理管道的配置对象
        options = PdfPipelineOptions()

        # 【核心】强制让 Docling 在解析 PDF 时，把每一页渲染成图片
        options.generate_page_images = True

        # 设置渲染页面的缩放比例为 1.5 倍，让生成的缩略图更清晰
        options.images_scale = 1.5

        # 实例化 Docling 转换器
        _converter = DocumentConverter(
            # 传入针对不同输入格式的具体配置
            format_options={
                # 针对 PDF 格式
                InputFormat.PDF: PdfFormatOption(
                    # 应用上面定义好的“生成页面图片”配置
                    pipeline_options=options,
                )
            }
        )

    # 返回全局唯一的转换器实例（后续调用直接复用，不再重复初始化）
    return _converter


# 内部函数：将 PIL 图片对象转换为 WebP 格式的字节流
def _encode_webp(image: Image.Image) -> bytes:
    # 如果原始图片宽度超过了我们设定的最大宽度 (900)
    if image.width > _THUMBNAIL_MAX_WIDTH:
        # 计算宽度缩小的比例
        ratio = _THUMBNAIL_MAX_WIDTH / image.width

        # 根据比例计算等比例缩放后的高度，确保最小高度为 1
        target_height = max(1, round(image.height * ratio))

        # 对图片进行实际缩放
        image = image.resize(
            # 传入计算好的目标宽高
            (_THUMBNAIL_MAX_WIDTH, target_height),
            # 使用 LANCZOS 算法（高质量的图像缩放算法，能减少锯齿和模糊）
            Image.Resampling.LANCZOS,
        )

    # 如果图片包含透明通道（如带透明背景的 PNG 或 WebP）
    if image.mode in {"RGBA", "LA"}:
        # 确保转换为标准的 RGBA 模式
        rgba = image.convert("RGBA")

        # 创建一张与图片同样大小的纯白背景图
        background = Image.new("RGB", rgba.size, "white")

        # 利用 alpha 通道作为掩码，将透明图片贴合到白底上
        background.paste(rgba, mask=rgba.getchannel("A"))

        # 将图片替换为合成后（去除了透明度）的图片
        image = background

    # 如果图片既没有透明度，且模式也不是标准的 RGB（例如 CMYK 模式的打印图或灰度图）
    elif image.mode != "RGB":
        # 强制转换为 RGB 模式，因为 WebP 编码通常需要 RGB 输入
        image = image.convert("RGB")

    # 在内存中创建一个二进制流对象，用于接收保存的图片数据（避免写入本地磁盘）
    output = BytesIO()

    # 将处理好的图片保存到内存流中
    image.save(
        # 指定输出目标为内存流
        output,
        # 指定保存的格式为 WebP
        format="WEBP",
        # 传入之前定义的质量参数 (82)
        quality=_THUMBNAIL_QUALITY,
        # 指定 WebP 编码器的压缩方法等级（0-6），6 表示最高压缩率（耗时略长，但体积最小）
        method=6,
    )

    # 从内存流中提取所有字节数据并返回
    return output.getvalue()


# 内部函数：从 PDF 的字节内容中渲染出第一页的缩略图
def _render_pdf_first_page(pdf_content: bytes) -> bytes:
    # 将传入的 PDF 字节流包装成 Docling 要求的 DocumentStream 对象
    stream = DocumentStream(
        # 给这个虚拟文件流随便起个名字
        name="thumbnail.pdf",
        # 把原始字节数据放入内存流中
        stream=BytesIO(pdf_content),
    )

    # 调用全局的 Docling 转换器进行解析
    result = _get_converter().convert(
        # 传入 PDF 流
        stream,
        # 【核心】告诉转换器只处理第 1 页到第 1 页，大幅提升渲染速度
        page_range=(1, 1),
    )

    # 从解析结果中提取出第一页的对象
    page = result.document.pages.get(1)

    # 健壮性检查：如果没拿到页面对象，或者该页面没有被渲染出图片
    if page is None or page.image is None:
        # 抛出业务异常
        raise ValueError("PDF 第一页没有可渲染的图片")

    # 从 Docling 的页面图片对象中提取出标准的 PIL (Pillow) 图片对象
    pil_image = page.image.pil_image

    # 如果解包出来的 PIL 图片为空
    if pil_image is None:
        # 抛出业务异常
        raise ValueError("PDF 第一页图片解码失败")

    # 将 PIL 图片传给前面写好的函数，转成 WebP 字节流并返回
    return _encode_webp(pil_image)


# 对外暴露的自动生成缩略图函数
def generate_thumbnail(filename: str, content: bytes) -> bytes | None:
    # 如果上传的文件后缀不是 .pdf（比如是 word 或 excel）
    if Path(filename).suffix.lower() != ".pdf":
        # 直接返回 None（前端可以据此展示默认的占位图标）
        return None

    # 开始捕获异常
    try:
        # 尝试渲染 PDF 第一页作为缩略图
        return _render_pdf_first_page(content)

    # 【关键设计】如果渲染失败（例如 PDF 损坏、加密等）
    except Exception as exc:
        # 记录警告日志
        logger.warning("pdf thumbnail failed for %s: %s", filename, exc)
        # 返回 None，保证生成缩略图失败不会阻断主文档的上传流程
        return None


# 对外暴露的手动生成缩略图函数（用于用户自己上传图片）
def generate_manual_thumbnail(filename: str, content: bytes) -> bytes:
    # 提取文件后缀并转为小写
    suffix = Path(filename).suffix.lower()

    # 如果用户上传的缩略图源文件居然是 PDF
    if suffix == ".pdf":
        # 调用上面的渲染函数去提取 PDF 第一页
        return _render_pdf_first_page(content)

    # 如果上传的后缀不在允许的图片白名单内 (jpg/jpeg/png/webp)
    if suffix not in _MANUAL_IMAGE_SUFFIXES:
        # 严格抛出业务错误，拒绝上传
        raise ValueError("缩略图仅支持 PDF、JPG、JPEG、PNG、WebP")

    # 捕获图片处理过程中的异常
    try:
        # 使用 Pillow 从字节流中打开图片（with 语法保证文件句柄自动关闭）
        with Image.open(BytesIO(content)) as image:
            # 计算图片总像素，如果超过 4000 万
            if image.width * image.height > _MANUAL_MAX_PIXELS:
                # 拒绝处理，防止恶意超大图撑爆内存
                raise ValueError("图片像素过大，请换一张小一点的图片")

            # 强制 Pillow 将图片完整解码到内存中（防止后续操作时读取到损坏的图片数据）
            image.load()

            # 【重要】读取图片的 EXIF 信息，自动修正手机拍摄照片时产生的方向旋转问题
            image = ImageOps.exif_transpose(image)

            # 将修正后的图片传入统一函数，转成 WebP 格式返回
            return _encode_webp(image)

    # 如果捕获到上面主动抛出的 ValueError（像素过大）
    except ValueError:
        # 直接原样抛出，保留具体的错误信息
        raise

    # 如果捕获到其他底层异常（如图片损坏、非图片格式）
    except Exception as exc:
        # 统一包装成对用户友好的业务错误信息，并通过 from 保留原始报错链
        raise ValueError("无法读取图片，请换一张 JPG/PNG/WebP") from exc