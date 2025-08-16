const { BrowserWindow, clipboard, nativeImage } = require('electron');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

class ScreenshotHandler {
  constructor() {
    this.lastScreenshotBuffer = null;
  }

  /**
   * 截取可视区域
   */
  async captureVisibleArea() {
    try {
      // 获取所有窗口，找到主窗口
      const allWindows = BrowserWindow.getAllWindows();
      const mainWindow = allWindows.find(win => !win.isDestroyed() && win.webContents);
      
      if (!mainWindow) {
        throw new Error('未找到主窗口');
      }

      console.log('开始截取可视区域...');
      
      // 获取内容区域的位置和尺寸，优先使用包含 padding 的容器
      const contentBounds = await mainWindow.webContents.executeJavaScript(`
        (function() {
          // 优先使用 content-area，保留 padding
          const contentArea = document.querySelector('.content-area');
          const previewArea = document.querySelector('.preview-area');
          const editorArea = document.querySelector('.editor-area');
          const markdownContent = document.querySelector('#markdownContent');
          
          let targetElement = null;
          if (contentArea && contentArea.style.display !== 'none') {
            targetElement = contentArea;
          } else if (previewArea && previewArea.style.display !== 'none') {
            targetElement = previewArea;
          } else if (editorArea && editorArea.style.display !== 'none') {
            targetElement = editorArea;
          } else if (markdownContent) {
            targetElement = markdownContent;
          }
          
          if (!targetElement) return null;
          
          const rect = targetElement.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            elementType: targetElement.className || targetElement.id
          };
        })();
      `);
      
      let image;
      if (contentBounds) {
        console.log(`截取区域: ${contentBounds.elementType}, 位置: ${contentBounds.x},${contentBounds.y}, 尺寸: ${contentBounds.width}x${contentBounds.height}`);
        // 截取指定的内容区域
        image = await mainWindow.webContents.capturePage({
          x: Math.round(contentBounds.x),
          y: Math.round(contentBounds.y),
          width: Math.round(contentBounds.width),
          height: Math.round(contentBounds.height)
        });
      } else {
        // 回退到全窗口截图
        image = await mainWindow.webContents.capturePage();
      }
      
      // 转换为 Buffer
      const buffer = image.toPNG();
      
      // 保存到剪切板
      await this.saveToClipboard(buffer);
      
      console.log('可视区域截图完成');
      return { success: true };
      
    } catch (error) {
      console.error('可视区域截图失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 截取当前段
   */
  async captureSegment(options) {
    try {
      // 获取所有窗口，找到主窗口
      const allWindows = BrowserWindow.getAllWindows();
      const mainWindow = allWindows.find(win => !win.isDestroyed() && win.webContents);
      
      if (!mainWindow) {
        throw new Error('未找到主窗口');
      }

      console.log(`截取段 ${options.segmentIndex + 1}, Y: ${options.y}, 高度: ${options.height}`);
      
      // 获取内容区域的位置和尺寸，优先使用包含 padding 的容器
      const contentBounds = await mainWindow.webContents.executeJavaScript(`
        (function() {
          // 优先使用 content-area，保留 padding
          const contentArea = document.querySelector('.content-area');
          const previewArea = document.querySelector('.preview-area');
          const editorArea = document.querySelector('.editor-area');
          const markdownContent = document.querySelector('#markdownContent');
          
          let targetElement = null;
          if (contentArea && contentArea.style.display !== 'none') {
            targetElement = contentArea;
          } else if (previewArea && previewArea.style.display !== 'none') {
            targetElement = previewArea;
          } else if (editorArea && editorArea.style.display !== 'none') {
            targetElement = editorArea;
          } else if (markdownContent) {
            targetElement = markdownContent;
          }
          
          if (!targetElement) return null;
          
          const rect = targetElement.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            elementType: targetElement.className || targetElement.id
          };
        })();
      `);
      
      if (!contentBounds) {
        // 如果无法获取内容区域，回退到全窗口截图
        const image = await mainWindow.webContents.capturePage();
        const buffer = image.toPNG();
        return { 
          success: true, 
          buffer: buffer.toString('base64')
        };
      }
      
      // 截取指定的内容区域
      const image = await mainWindow.webContents.capturePage({
        x: Math.round(contentBounds.x),
        y: Math.round(contentBounds.y),
        width: Math.round(contentBounds.width),
        height: Math.round(contentBounds.height)
      });
      
      // 转换为 Buffer
      const buffer = image.toPNG();
      
      // 保存单个段的调试图片
      await this.saveSegmentToTest(buffer, options.segmentIndex);
      
      return { 
        success: true, 
        buffer: buffer.toString('base64')
      };
      
    } catch (error) {
      console.error(`段 ${options.segmentIndex + 1} 截图失败:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 拼接多个截图段
   */
  async stitchScreenshots(options) {
    try {
      const { segments, totalHeight, totalWidth, config } = options;
      
      console.log(`开始拼接 ${segments.length} 个图片段, 目标尺寸: ${totalWidth}x${totalHeight}`);

      if (segments.length === 0) {
        throw new Error('没有图片段可拼接');
      }

      if (segments.length === 1) {
        // 只有一个段，直接保存
        const buffer = Buffer.from(segments[0].buffer, 'base64');
        await this.saveToClipboard(buffer);
        return { success: true };
      }

      // 检查是否需要分批处理（超过10个段或总高度超过8000像素）
      const shouldBatchProcess = segments.length > 10 || totalHeight > 8000;
      
      if (shouldBatchProcess) {
        console.log('启用分批拼接模式');
        return await this.batchStitchScreenshots(segments, totalWidth, config);
      }

      return await this.directStitchScreenshots(segments, totalHeight, totalWidth, config);

    } catch (error) {
      console.error('图片拼接失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 直接拼接模式（适用于小规模截图）
   */
  async directStitchScreenshots(segments, totalHeight, totalWidth, config) {
    try {
      // 准备合成操作
      const composite = [];
      let currentY = 0;
      let actualCanvasWidth = totalWidth;
      let actualCanvasHeight = totalHeight;

      // 首先获取第一个段的实际尺寸来确定画布尺寸
      const firstBuffer = Buffer.from(segments[0].buffer, 'base64');
      const firstImageInfo = await sharp(firstBuffer).metadata();
      actualCanvasWidth = firstImageInfo.width;
      console.log(`根据第一段确定画布宽度: ${totalWidth} -> ${actualCanvasWidth}`);

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const buffer = Buffer.from(segment.buffer, 'base64');
        
        console.log(`处理段 ${i + 1}/${segments.length}: Y=${currentY}, 原始Y=${segment.y}, 实际滚动=${segment.actualScrollY || segment.y}, 高度=${segment.height}, 最后段=${!!segment.isLastSegment}`);

        if (i === 0) {
          // 第一个段直接添加
          composite.push({
            input: buffer,
            top: 0,
            left: 0
          });
          currentY = firstImageInfo.height;
        } else {
          // 后续段需要处理重叠
          let overlapPixels = this.calculateOptimalOverlap(segment.height, config.overlapPixels || 20);
          
          // 对于最后一段，如果滚动位置不准确，需要重新计算Y位置
          if (segment.isLastSegment && segment.actualScrollY !== undefined) {
            const expectedScrollY = segment.y;
            const actualScrollY = segment.actualScrollY;
            const scrollDiff = expectedScrollY - actualScrollY;
            
            if (Math.abs(scrollDiff) > 50) { // 滚动误差超过50px
              console.log(`最后段滚动偏差: 期望=${expectedScrollY}, 实际=${actualScrollY}, 差值=${scrollDiff}px`);
              
              // 重新计算最后一段在画布中的Y位置
              // 如果实际滚动更靠前(scrollDiff > 0)，说明内容向上偏移了，需要上移
              const adjustedY = Math.round(currentY - scrollDiff);
              console.log(`调整最后段Y位置: ${currentY} -> ${adjustedY} (滚动偏差=${scrollDiff}px)`);
              
              // 重新设置合成位置
              currentY = adjustedY;
            }
          }
          
          // 获取当前段图片信息
          const imageInfo = await sharp(buffer).metadata();
          
          // 计算缩放比例（如果需要）
          const scaleX = actualCanvasWidth / imageInfo.width;
          const actualOverlapPixels = Math.round(overlapPixels * (imageInfo.height / segment.height));
          const actualHeight = imageInfo.height - actualOverlapPixels;
          
          console.log(`段 ${i + 1} 处理参数: 原图=${imageInfo.width}x${imageInfo.height}, 缩放=${scaleX.toFixed(2)}, 重叠=${actualOverlapPixels}px, 有效高度=${actualHeight}px`);
          
          if (actualHeight > 5) { // 至少保留5像素有效内容
            let processedBuffer = buffer;
            
            // 如果需要裁剪重叠部分
            if (actualOverlapPixels > 0) {
              processedBuffer = await sharp(buffer)
                .extract({
                  left: 0,
                  top: actualOverlapPixels,
                  width: imageInfo.width,
                  height: actualHeight
                })
                .png()
                .toBuffer();
            }
            
            // 如果宽度不匹配，进行缩放
            if (imageInfo.width !== actualCanvasWidth) {
              const targetHeight = Math.round(actualHeight * scaleX);
              processedBuffer = await sharp(processedBuffer)
                .resize(actualCanvasWidth, targetHeight, {
                  fit: 'fill'
                })
                .png()
                .toBuffer();
                
              console.log(`段 ${i + 1} 缩放到: ${actualCanvasWidth}x${targetHeight}`);
              
              composite.push({
                input: processedBuffer,
                top: currentY,
                left: 0
              });
              
              currentY += targetHeight;
            } else {
              composite.push({
                input: processedBuffer,
                top: currentY,
                left: 0
              });
              
              currentY += actualHeight;
            }
          } else {
            console.warn(`段 ${i + 1} 高度不足（${actualHeight}px），跳过处理`);
          }
        }
      }
      
      // 使用实际内容高度，确保是整数
      actualCanvasHeight = Math.round(currentY);
      console.log(`最终画布尺寸: ${actualCanvasWidth}x${actualCanvasHeight}`);
      
      // 创建最终画布并合成
      const finalCanvas = sharp({
        create: {
          width: actualCanvasWidth,
          height: actualCanvasHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      }).png();

      // 执行合成，添加超时机制
      console.log('开始图片合成...');
      console.log(`合成参数: 画布=${actualCanvasWidth}x${actualCanvasHeight}, 合成层数=${composite.length}`);
      
      // 检查合成参数有效性
      for (let i = 0; i < composite.length; i++) {
        const layer = composite[i];
        try {
          const metadata = await sharp(layer.input).metadata();
          console.log(`合成层 ${i + 1}: 尺寸=${metadata.width}x${metadata.height}, 位置=(${layer.left},${layer.top})`);
          
          // 检查边界
          if (layer.left < 0 || layer.top < 0) {
            throw new Error(`合成层 ${i + 1} 位置无效: (${layer.left},${layer.top})`);
          }
          if (layer.left + metadata.width > actualCanvasWidth || layer.top + metadata.height > actualCanvasHeight) {
            console.warn(`合成层 ${i + 1} 超出画布边界: 层=(${metadata.width}x${metadata.height}) 位置=(${layer.left},${layer.top}) 画布=(${actualCanvasWidth}x${actualCanvasHeight})`);
          }
        } catch (metaError) {
          console.error(`合成层 ${i + 1} 元数据检查失败:`, metaError.message);
          throw metaError;
        }
      }
      
      const compositePromise = finalCanvas.composite(composite).png().toBuffer();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('图片合成超时')), 30000) // 30秒超时
      );
      
      const result = await Promise.race([compositePromise, timeoutPromise]);
      
      // 移除右侧滚动条（固定裁剪20px）
      const finalResult = await this.removeScrollbar(result, actualCanvasWidth, actualCanvasHeight);
      
      // 保存到剪切板
      await this.saveToClipboard(finalResult);
      
      console.log('图片拼接完成');
      return { success: true };

    } catch (sharpError) {
      console.error('Sharp 图片处理失败:', sharpError);
      console.error('错误详情:', sharpError.message);
      console.error('错误堆栈:', sharpError.stack);
      
      // 打印段信息帮助调试
      console.error('段信息:');
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        console.error(`  段 ${i + 1}: Y=${seg.y}, 实际滚动=${seg.actualScrollY}, 高度=${seg.height}, 最后段=${seg.isLastSegment}`);
      }
      
      return await this.fallbackToFirstSegment(segments);
    }
  }

  /**
   * 分批拼接模式（适用于大规模截图）
   */
  async batchStitchScreenshots(segments, totalWidth, config) {
    try {
      const batchSize = 5; // 每批处理5个段
      const batches = [];
      
      // 将段分组
      for (let i = 0; i < segments.length; i += batchSize) {
        batches.push(segments.slice(i, i + batchSize));
      }
      
      console.log(`分成 ${batches.length} 批处理，每批最多 ${batchSize} 个段`);
      
      let intermediateResults = [];
      
      // 逐批处理
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`处理第 ${batchIndex + 1}/${batches.length} 批 (${batch.length} 个段)`);
        
        const batchResult = await this.processBatch(batch, totalWidth, config, batchIndex === 0);
        if (batchResult.success) {
          intermediateResults.push({
            buffer: batchResult.buffer,
            height: batchResult.height
          });
        } else {
          throw new Error(`批 ${batchIndex + 1} 处理失败: ${batchResult.error}`);
        }
      }
      
      // 合并所有批的结果
      console.log(`合并 ${intermediateResults.length} 个批次结果`);
      const finalResult = await this.mergeBatchResults(intermediateResults, totalWidth);
      
      if (finalResult.success) {
        await this.saveToClipboard(finalResult.buffer);
        console.log('分批拼接完成');
        return { success: true };
      } else {
        throw new Error(`批次合并失败: ${finalResult.error}`);
      }
      
    } catch (error) {
      console.error('分批拼接失败:', error);
      return await this.fallbackToFirstSegment(segments);
    }
  }

  /**
   * 处理单个批次
   */
  async processBatch(batch, totalWidth, config, isFirstBatch) {
    try {
      const composite = [];
      let currentY = 0;
      
      for (let i = 0; i < batch.length; i++) {
        const segment = batch[i];
        const buffer = Buffer.from(segment.buffer, 'base64');
        
        if (i === 0 && isFirstBatch) {
          // 第一批的第一个段直接添加
          composite.push({
            input: buffer,
            top: 0,
            left: 0
          });
          currentY = segment.height;
        } else {
          // 处理重叠
          const overlapPixels = this.calculateOptimalOverlap(segment.height, config.overlapPixels || 20);
          const actualHeight = segment.height - overlapPixels;
          
          if (actualHeight > 5) {
            // 获取原图尺寸以确保裁剪参数正确
            const imageInfo = await sharp(buffer).metadata();
            const cropWidth = Math.min(imageInfo.width, totalWidth);
            const cropHeight = Math.min(actualHeight, imageInfo.height - overlapPixels);
            
            const croppedBuffer = await sharp(buffer)
              .extract({
                left: 0,
                top: overlapPixels,
                width: cropWidth,
                height: cropHeight
              })
              .png()
              .toBuffer();

            composite.push({
              input: croppedBuffer,
              top: currentY,
              left: 0
            });

            currentY += actualHeight;
          }
        }
      }
      
      // 创建批次结果
      const batchCanvas = sharp({
        create: {
          width: totalWidth,
          height: currentY,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      }).png();
      
      const batchBuffer = await batchCanvas.composite(composite).png().toBuffer();
      
      return {
        success: true,
        buffer: batchBuffer,
        height: currentY
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 合并批次结果
   */
  async mergeBatchResults(intermediateResults, totalWidth) {
    try {
      if (intermediateResults.length === 1) {
        return { success: true, buffer: intermediateResults[0].buffer };
      }
      
      const totalHeight = intermediateResults.reduce((sum, result) => sum + result.height, 0);
      
      const composite = [];
      let currentY = 0;
      
      for (const result of intermediateResults) {
        composite.push({
          input: result.buffer,
          top: currentY,
          left: 0
        });
        currentY += result.height;
      }
      
      const finalCanvas = sharp({
        create: {
          width: totalWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      }).png();
      
      const finalBuffer = await finalCanvas.composite(composite).png().toBuffer();
      
      return { success: true, buffer: finalBuffer };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 计算最优重叠像素数
   */
  calculateOptimalOverlap(segmentHeight, configuredOverlap) {
    // 重叠不应超过段高度的30%，且至少保留10像素有效内容
    const maxOverlap = Math.floor(segmentHeight * 0.3);
    const minEffectiveHeight = 10;
    const maxAllowedOverlap = segmentHeight - minEffectiveHeight;
    
    return Math.min(configuredOverlap, maxOverlap, maxAllowedOverlap);
  }

  /**
   * 移除右侧滚动条
   */
  async removeScrollbar(imageBuffer, width, height) {
    try {
      console.log('移除右侧滚动条...');
      
      // 固定裁剪右侧20px（滚动条通常为15-20px）
      const scrollbarWidth = 20;
      const croppedWidth = width - scrollbarWidth;
      
      console.log(`裁剪右侧 ${scrollbarWidth}px，开始处理...`);
      
      const result = await sharp(imageBuffer)
        .extract({
          left: 0,
          top: 0,
          width: croppedWidth,
          height: height
        })
        .png()
        .toBuffer();
        
      console.log(`滚动条移除完成，图片尺寸: ${width}x${height} -> ${croppedWidth}x${height}`);
      return result;
      
    } catch (error) {
      console.warn('移除滚动条失败，使用原图:', error.message);
      return imageBuffer;
    }
  }


  /**
   * 回退到保存第一个段
   */
  async fallbackToFirstSegment(segments) {
    try {
      console.log('使用回退方案：保存第一个截图段');
      const firstBuffer = Buffer.from(segments[0].buffer, 'base64');
      await this.saveToClipboard(firstBuffer);
      return { success: true, warning: '使用了回退方案，可能不是完整截图' };
    } catch (error) {
      return { success: false, error: `回退方案也失败了: ${error.message}` };
    }
  }

  /**
   * 保存图片到剪切板
   */
  async saveToClipboard(buffer) {
    try {
      console.log('保存图片到剪切板...');
      
      // 创建 NativeImage
      const image = nativeImage.createFromBuffer(buffer);
      
      // 保存到剪切板
      clipboard.writeImage(image);
      
      // 缓存最后一次截图
      this.lastScreenshotBuffer = buffer;
      
      // 同时保存到test/目录进行调试
      await this.saveToTestDirectory(buffer);
      
      console.log('图片已保存到剪切板');
      
    } catch (error) {
      console.error('保存到剪切板失败:', error);
      throw error;
    }
  }

  /**
   * 保存图片到test/目录用于调试
   */
  async saveToTestDirectory(buffer) {
    try {
      const path = require('path');
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
      const filename = `screenshot_final_${timestamp}.png`;
      const filepath = path.join(__dirname, '../../test', filename);
      
      await fs.promises.writeFile(filepath, buffer);
      console.log(`最终拼接图片已保存到: ${filepath}`);
      
    } catch (error) {
      console.warn('保存调试图片失败:', error.message);
      // 不抛出错误，因为这只是调试功能
    }
  }

  /**
   * 保存单个段的图片到test/目录用于调试
   */
  async saveSegmentToTest(buffer, segmentIndex) {
    try {
      const path = require('path');
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
      const filename = `segment_${segmentIndex + 1}_${timestamp}.png`;
      const filepath = path.join(__dirname, '../../test', filename);
      
      await fs.promises.writeFile(filepath, buffer);
      console.log(`段 ${segmentIndex + 1} 图片已保存到: ${filepath}`);
      
    } catch (error) {
      console.warn(`保存段 ${segmentIndex + 1} 调试图片失败:`, error.message);
    }
  }

  /**
   * 获取最后一次截图的信息
   */
  getLastScreenshotInfo() {
    if (!this.lastScreenshotBuffer) {
      return null;
    }

    return {
      size: this.lastScreenshotBuffer.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 清理缓存
   */
  cleanup() {
    this.lastScreenshotBuffer = null;
    console.log('ScreenshotHandler 缓存已清理');
  }
}

module.exports = ScreenshotHandler;