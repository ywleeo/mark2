#!/bin/bash

# 圆角图片生成工具
# 将方形图片转换为 1024x1024 大圆角图片

# 使用说明
show_usage() {
    echo "用法: $0 <输入图片> [输出图片] [圆角大小]"
    echo "示例: $0 input.png output.png 150"
    echo "参数说明:"
    echo "  输入图片: 要处理的方形图片路径"
    echo "  输出图片: 输出文件路径 (可选，默认为 input_rounded.png)"
    echo "  圆角大小: 圆角半径像素值 (可选，默认为 150)"
    exit 1
}

# 检查参数
if [ $# -lt 1 ]; then
    show_usage
fi

INPUT_FILE="$1"
OUTPUT_FILE="${2:-${INPUT_FILE%.*}_rounded.png}"
CORNER_RADIUS="${3:-150}"

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
echo "输出文件: $OUTPUT_FILE"
echo "圆角大小: ${CORNER_RADIUS}px"

# 步骤1: 缩放到 1024x1024
echo "正在缩放图片到 1024x1024..."
magick "$INPUT_FILE" -resize 1024x1024 temp_1024.png

if [ $? -ne 0 ]; then
    echo "错误: 图片缩放失败"
    exit 1
fi

# 步骤2: 添加大圆角
echo "正在添加圆角效果..."
magick temp_1024.png \( +clone -alpha extract -draw "fill black polygon 0,0 0,$CORNER_RADIUS $CORNER_RADIUS,0 fill white circle $CORNER_RADIUS,$CORNER_RADIUS $CORNER_RADIUS,0" \( +clone -flip \) -compose Multiply -composite \( +clone -flop \) -compose Multiply -composite \) -alpha off -compose CopyOpacity -composite "$OUTPUT_FILE"

if [ $? -ne 0 ]; then
    echo "错误: 圆角处理失败"
    rm -f temp_1024.png
    exit 1
fi

# 清理临时文件
rm -f temp_1024.png

echo "✅ 处理完成! 输出文件: $OUTPUT_FILE"

# 显示文件信息
if command -v magick &> /dev/null; then
    echo "输出图片信息:"
    magick identify "$OUTPUT_FILE"
fi