#!/usr/bin/env python3
from PIL import Image, ImageDraw

# 读取原图标
original = Image.open('src-tauri/icons/icon_backup.png')
size = 1024

# 创建圆角蒙版（macOS 标准圆角比例约 22.37%）
mask = Image.new('L', (size, size), 0)
draw = ImageDraw.Draw(mask)
radius = int(size * 0.2237)  # macOS 标准圆角
draw.rounded_rectangle([(0, 0), (size-1, size-1)], radius=radius, fill=255)

# 应用蒙版
output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
output.paste(original, (0, 0))
output.putalpha(mask)

# 保存
output.save('src-tauri/icons/icon.png')
print("图标已更新")
