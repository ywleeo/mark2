class HeartbeatAnimator {
  constructor() {
    this.isRunning = false;
    this.animationId = null;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.activeTimeouts = new Set();
    
    // 动画配置
    this.config = {
      text: '########## MARK2 ##########',
      fontFamily: 'Monaco, monospace',
      lightColor: '#333333',  // light模式字体颜色
      darkColor: '#00ff41',   // dark模式字体颜色
      moveSpeed: 0.5,
      jumpHeight: 30,
      jumpDuration: 400,
      letterSpacing: 3  // 字间距设置（像素）
    };
    
    // 动画状态
    this.time = 0;
    this.textX = 0;
    this.textMetrics = null;
    this.characters = [];
    this.centerX = 0;
  }
  
  setManagedTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      callback();
    }, delay);
    this.activeTimeouts.add(timeoutId);
    return timeoutId;
  }
  
  start(container) {
    if (this.isRunning) return;
    
    this.container = container;
    this.isRunning = true;
    
    this.createCanvas();
    this.animate();
  }
  
  stop() {
    this.isRunning = false;
    
    // 清理所有定时器
    this.activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.activeTimeouts.clear();
    
    // 取消动画帧
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    // 清理DOM
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    // 重置状态
    this.time = 0;
    this.textX = 0;
    this.canvas = null;
    this.ctx = null;
    this.characters = [];
    this.centerX = 0;
  }
  
  createCanvas() {
    // 清理现有canvas
    const existingCanvas = this.container.querySelector('.heartbeat-canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }
    
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'heartbeat-canvas';
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${this.config.backgroundColor};
      z-index: 1000;
    `;
    
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    // 设置canvas尺寸
    this.resizeCanvas();
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => this.resizeCanvas());
  }
  
  resizeCanvas() {
    // 检查container和canvas是否存在
    if (!this.container || !this.canvas) {
      return;
    }
    
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // 重新计算文字尺寸和中心点
    this.ctx.font = `12px ${this.config.fontFamily}`;
    this.textMetrics = this.ctx.measureText(this.config.text);
    this.centerX = rect.width / 2;
    
    // 初始化字符数组和起始位置 - 让字符串末端坐标为0
    this.initializeCharacters();
    // 计算实际的字符宽度总和
    const actualTextWidth = this.calculateActualTextWidth();
    this.textX = -actualTextWidth;
  }
  
  calculateActualTextWidth() {
    this.ctx.font = `12px ${this.config.fontFamily}`;
    let totalWidth = 0;
    
    for (let i = 0; i < this.config.text.length; i++) {
      const charWidth = this.ctx.measureText(this.config.text[i]).width;
      totalWidth += charWidth;
      if (i < this.config.text.length - 1) {
        totalWidth += this.config.letterSpacing;
      }
    }
    
    return totalWidth;
  }
  
  initializeCharacters() {
    this.characters = [];
    const text = this.config.text;
    
    // 为每个字符创建状态对象
    for (let i = 0; i < text.length; i++) {
      this.characters.push({
        char: text[i],
        x: 0,
        y: 0,
        jumpOffset: 0,
        isJumping: false,
        jumpStartTime: 0
      });
    }
  }
  
  drawMovingText(width, height) {
    if (!this.textMetrics || this.characters.length === 0) return;
    
    // 使用实际CSS尺寸而不是canvas像素尺寸
    const rect = this.container.getBoundingClientRect();
    const centerY = rect.height / 2;
    const currentTime = performance.now();
    
    this.ctx.font = `12px ${this.config.fontFamily}`;
    // 根据主题设置字体颜色
    const isDark = this.getCurrentTheme() === 'dark';
    this.ctx.fillStyle = isDark ? this.config.darkColor : this.config.lightColor;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    
    // 计算每个字符的位置
    let charX = this.textX;
    
    for (let i = 0; i < this.characters.length; i++) {
      const char = this.characters[i];
      const charWidth = this.ctx.measureText(char.char).width;
      
      // 检查字符是否经过中心点
      const charCenterX = charX + charWidth / 2;
      const distanceFromCenter = Math.abs(charCenterX - this.centerX);
      
      // 如果字符接近中心点且还没有开始跳跃，开始跳跃动画
      if (distanceFromCenter < 20 && !char.isJumping) {
        char.isJumping = true;
        char.jumpStartTime = currentTime;
      }
      
      // 计算跳跃偏移
      if (char.isJumping) {
        const elapsed = currentTime - char.jumpStartTime;
        const progress = Math.min(elapsed / this.config.jumpDuration, 1);
        
        if (progress < 1) {
          // 使用正弦函数创建跳跃效果
          char.jumpOffset = Math.sin(progress * Math.PI) * this.config.jumpHeight;
        } else {
          // 跳跃完成
          char.isJumping = false;
          char.jumpOffset = 0;
        }
      }
      
      // 绘制字符 - 使用实际CSS尺寸计算垂直位置
      const charY = centerY - char.jumpOffset;
      this.ctx.fillText(char.char, charX, charY);
      
      charX += charWidth + this.config.letterSpacing;
    }
  }
  
  animate() {
    if (!this.isRunning) return;
    
    this.time += 16; // 假设60fps
    
    const width = this.canvas.width / window.devicePixelRatio;
    const height = this.canvas.height / window.devicePixelRatio;
    
    // 更新文字位置
    this.textX += this.config.moveSpeed;
    
    // 重置位置当文字开始移出屏幕
    const actualTextWidth = this.calculateActualTextWidth();
    if (this.textX > width) {
      // 重置到初始位置，让字符串末端坐标为0
      this.textX = -actualTextWidth;
      // 重置所有字符的跳跃状态
      this.characters.forEach(char => {
        char.isJumping = false;
        char.jumpOffset = 0;
      });
    }
    
    // 清空画布
    this.ctx.clearRect(0, 0, width, height);
    
    // 绘制移动的文字
    this.drawMovingText(width, height);
    
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  getCurrentTheme() {
     // 使用与项目中一致的主题检测方法
     // 方法1: 检查当前加载的CSS文件
     const themeCSS = document.getElementById('theme-css');
     if (themeCSS && themeCSS.href && themeCSS.href.includes('dark-theme.css')) {
       return 'dark';
     }
     
     // 方法2: 检查localStorage
     const storedTheme = localStorage.getItem('theme');
     if (storedTheme === 'dark') {
       return 'dark';
     }
     
     return 'light';
   }

}

module.exports = HeartbeatAnimator;