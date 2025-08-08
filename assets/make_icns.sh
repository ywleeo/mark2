#!/bin/bash

# ICNS 文件生成工具
# 为图片添加 alpha 通道并生成完整的 icns 文件

# 使用说明
show_usage() {
    echo "用法: $0 <输入图片> [输出名称] [缩放比例]"
    echo "示例: $0 input.png myapp 0.85"
    echo "参数说明:"
    echo "  输入图片: 要处理的图片路径 (建议 1024x1024 或更大)"
    echo "  输出名称: 输出文件名 (可选，默认为输入文件名)"
    echo "  缩放比例: 图标实际大小相对于画布的比例 (可选，默认为 1.0)"
    echo ""
    echo "输出文件:"
    echo "  - [名称]_with_alpha.png: 带 alpha 通道的 PNG"
    echo "  - [名称].iconset/: 包含所有尺寸的文件夹"
    echo "  - [名称].icns: 最终的 ICNS 文件"
    exit 1
}

# 检查参数
if [ $# -lt 1 ]; then
    show_usage
fi

INPUT_FILE="$1"
BASE_NAME="${2:-$(basename "${INPUT_FILE%.*}")}"
SCALE_RATIO="${3:-1.0}"

# 检查输入文件是否存在
if [ ! -f "$INPUT_FILE" ]; then
    echo "错误: 输入文件 '$INPUT_FILE' 不存在"
    exit 1
fi

# 检查是否安装了 ImageMagick
if ! command -v magick &> /dev/null; then
    echo "错误: 未找到 ImageMagick，请先安装 ImageMagick"
    echo "安装命令: brew install imagemagick"
    exit 1
fi

echo "处理图片: $INPUT_FILE"
echo "输出名称: $BASE_NAME"
echo "缩放比例: $SCALE_RATIO"

# 步骤1: 为图片添加 alpha 通道
echo "正在添加 alpha 通道..."
ALPHA_FILE="${BASE_NAME}_with_alpha.png"

# 检查图片是否已有 alpha 通道
CHANNELS=$(magick identify -format "%[channels]" "$INPUT_FILE")
if [[ "$CHANNELS" == *"a"* ]]; then
    echo "图片已有 alpha 通道，直接复制..."
    cp "$INPUT_FILE" "$ALPHA_FILE"
else
    echo "添加 alpha 通道..."
    magick "$INPUT_FILE" -alpha set "$ALPHA_FILE"
fi

if [ $? -ne 0 ]; then
    echo "错误: alpha 通道处理失败"
    exit 1
fi

# 步骤2: 创建 iconset 目录
ICONSET_DIR="${BASE_NAME}.iconset"
echo "创建 iconset 目录: $ICONSET_DIR"

if [ -d "$ICONSET_DIR" ]; then
    rm -rf "$ICONSET_DIR"
fi
mkdir "$ICONSET_DIR"

# 步骤3: 生成所有需要的尺寸
echo "生成各种尺寸的图标..."

# 定义所有需要的尺寸和文件名
declare -a sizes=(
    "16:icon_16x16.png"
    "32:icon_16x16@2x.png"
    "32:icon_32x32.png"
    "64:icon_32x32@2x.png"
    "128:icon_128x128.png"
    "256:icon_128x128@2x.png"
    "256:icon_256x256.png"
    "512:icon_256x256@2x.png"
    "512:icon_512x512.png"
    "1024:icon_512x512@2x.png"
)

# 生成每个尺寸
for size_info in "${sizes[@]}"; do
    IFS=':' read -r size filename <<< "$size_info"
    echo "生成 ${size}x${size} -> $filename"
    
    # 计算实际图标大小和偏移
    SCALED_SIZE=$(echo "$size * $SCALE_RATIO" | bc -l | cut -d. -f1)
    OFFSET=$(echo "($size - $SCALED_SIZE) / 2" | bc -l | cut -d. -f1)
    
    if [ "$SCALE_RATIO" != "1.0" ]; then
        # 创建透明画布，并将缩放后的图像居中放置
        magick -size "${size}x${size}" xc:transparent \( "$ALPHA_FILE" -resize "${SCALED_SIZE}x${SCALED_SIZE}" \) -geometry "+${OFFSET}+${OFFSET}" -composite "$ICONSET_DIR/$filename"
    else
        # 直接缩放
        magick "$ALPHA_FILE" -resize "${size}x${size}" "$ICONSET_DIR/$filename"
    fi
    
    if [ $? -ne 0 ]; then
        echo "错误: 生成 $filename 失败"
        exit 1
    fi
done

# 步骤4: 生成 ICNS 文件
ICNS_FILE="${BASE_NAME}.icns"
echo "生成 ICNS 文件: $ICNS_FILE"

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_FILE"

if [ $? -ne 0 ]; then
    echo "错误: ICNS 文件生成失败"
    echo "注意: iconutil 需要在 macOS 系统上运行"
    exit 1
fi

echo "✅ 处理完成!"
echo ""
echo "生成的文件:"
echo "  📁 $ICONSET_DIR/ (包含所有尺寸)"
echo "  🖼️  $ALPHA_FILE (带 alpha 通道的 PNG)"
echo "  📦 $ICNS_FILE (最终的 ICNS 文件)"
echo ""

# 显示文件信息
if [ -f "$ICNS_FILE" ]; then
    echo "ICNS 文件信息:"
    ls -lh "$ICNS_FILE"
    
    echo ""
    echo "验证 ICNS 内容:"
    iconutil --convert iconset "$ICNS_FILE" --output temp_verify.iconset
    if [ -d temp_verify.iconset ]; then
        echo "ICNS 包含以下尺寸:"
        ls temp_verify.iconset/
        rm -rf temp_verify.iconset
    fi
fi