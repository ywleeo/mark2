class ASCIIAnimator {
  constructor() {
    this.isRunning = false;
    this.animationFrame = null;
    this.startTime = null;
    this.canvas = null;
    
    // 动画参数
    this.width = 25;  // 画布宽度（字符数）
    this.height = 8;  // 画布高度（行数）
    
    // mark2 字符
    this.chars = ['m', 'a', 'r', 'k', '2'];
    
    // 粒子系统
    this.particles = [];
    this.initParticles();
  }
  
  initParticles() {
    // 为每个 mark2 字符创建粒子 - 简化为圆形分布
    this.chars.forEach((char, i) => {
      this.particles.push({
        char: char,
        angleOffset: (i * Math.PI * 2) / this.chars.length, // 在圆周上的初始角度
        radius: 4, // 固定半径
        centerX: this.width / 2,
        centerY: this.height / 2
      });
    });
  }
  
  start(container) {
    console.log('ASCIIAnimator.start called, isRunning:', this.isRunning);
    if (this.isRunning) return;
    
    this.container = container;
    this.isRunning = true;
    this.startTime = performance.now();
    
    console.log('Creating animation display');
    // 创建动画显示区域
    this.createAnimationDisplay();
    
    console.log('Starting animation loop');
    // 开始动画循环
    this.animationFrame = requestAnimationFrame((time) => this.animate(time));
  }
  
  stop() {
    this.isRunning = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // 清理动画显示
    if (this.animationDisplay) {
      this.animationDisplay.remove();
      this.animationDisplay = null;
    }
  }
  
  createAnimationDisplay() {
    this.animationDisplay = document.createElement('div');
    this.animationDisplay.className = 'ascii-animation';
    this.animationDisplay.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.0;
      white-space: pre;
      text-align: center;
      color: #afafaf;
      letter-spacing: 1px;
      margin: 0;
      padding: 0;
    `;
    
    this.container.appendChild(this.animationDisplay);
  }
  
  animate(currentTime) {
    if (!this.isRunning) return;
    
    const elapsed = (currentTime - this.startTime) / 1000; // 转换为秒
    
    // 创建画布
    this.canvas = Array(this.height).fill(null).map(() => Array(this.width).fill(' '));
    
    // 公转角度 - 所有字符一起绕中心旋转
    const revolutionAngle = elapsed * 0.5; // 公转速度
    
    // 更新每个 mark2 字符的位置 - 简单的圆形公转
    this.particles.forEach((particle, index) => {
      // 计算当前角度 = 公转角度 + 初始偏移角度
      const currentAngle = revolutionAngle + particle.angleOffset;
      
      // 圆形运动
      const x = particle.centerX + particle.radius * Math.cos(currentAngle);
      const y = particle.centerY + particle.radius * Math.sin(currentAngle) * 0.6; // 稍微压扁一点
      
      // 确保坐标在画布范围内
      const pixelX = Math.floor(Math.max(0, Math.min(this.width - 1, x + 0.5)));
      const pixelY = Math.floor(Math.max(0, Math.min(this.height - 1, y + 0.5)));
      
      // 直接显示字符，不需要闪烁效果
      this.canvas[pixelY][pixelX] = particle.char;
    });
    
    // 渲染画布
    this.render();
    
    // 继续动画
    this.animationFrame = requestAnimationFrame((time) => this.animate(time));
  }
  
  render() {
    if (this.animationDisplay) {
      const frame = this.canvas.map(row => row.join('')).join('\n');
      this.animationDisplay.textContent = frame;
    }
  }
  
  // 获取静态帧（用于静态显示）
  getStaticFrame() {
    // 创建静态画布
    const canvas = Array(this.height).fill(null).map(() => Array(this.width).fill(' '));
    
    // 在中心横向排列 mark2
    const centerY = Math.floor(this.height / 2);
    const startX = Math.floor(this.width / 2) - 2; // mark2 有5个字符，所以从中心-2开始
    
    this.chars.forEach((char, i) => {
      const x = startX + i;
      if (x >= 0 && x < this.width) {
        canvas[centerY][x] = char;
      }
    });
    
    return canvas.map(row => row.join('')).join('\n');
  }
  
  // 创建静态显示（不启动动画）
  createStaticDisplay(container) {
    const staticDisplay = document.createElement('div');
    staticDisplay.className = 'ascii-static';
    staticDisplay.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.0;
      white-space: pre;
      text-align: center;
      margin: 15px 0;
      color: #888;
      letter-spacing: 1px;
    `;
    
    staticDisplay.textContent = this.getStaticFrame();
    container.appendChild(staticDisplay);
    
    return staticDisplay;
  }
}

module.exports = ASCIIAnimator;