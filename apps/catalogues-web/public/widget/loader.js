(() => {
  const WIDGET_ORIGIN = 'https://app.aivastra.com';

  function createStyles() {
    const style = document.createElement('style');
    style.textContent =
      '#aivastra-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:2147483646;display:flex;align-items:center;justify-content:center}' +
      '#aivastra-frame{width:437px;height:min(650px,90vh);border:none;border-radius:16px;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,.24);overflow:hidden}' +
      '#aivastra-close{position:absolute;top:16px;right:16px;background:rgba(0,0,0,.4);border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:16px;cursor:pointer;display:none;align-items:center;justify-content:center}';
    document.head.appendChild(style);
  }

  function openWidget(opts) {
    if (!opts?.garment_image) return;
    if (!window.AIVASTRA_WIDGET?.widget_key) return;

    const key = window.AIVASTRA_WIDGET.widget_key;

    let overlay = document.getElementById('aivastra-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'aivastra-overlay';

      const container = document.createElement('div');
      container.style.position = 'relative';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';

      const newFrame = document.createElement('iframe');
      newFrame.id = 'aivastra-frame';
      newFrame.allow = 'clipboard-write';

      const newCloseBtn = document.createElement('button');
      newCloseBtn.id = 'aivastra-close';
      newCloseBtn.textContent = '×';
      newCloseBtn.onclick = closeWidget;

      container.appendChild(newFrame);
      container.appendChild(newCloseBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
    }

    const iframe = document.getElementById('aivastra-frame');
    iframe.src = `${WIDGET_ORIGIN}/widget/render/${key}`;

    const closeBtn = document.getElementById('aivastra-close');
    closeBtn.style.display = 'flex';

    iframe.onload = () => {
      iframe.contentWindow.postMessage(
        { type: 'INIT_TRYON', payload: { garment_image: opts.garment_image } },
        '*',
      );
    };

    window.addEventListener('message', function handler(e) {
      if (e.data && e.data.type === 'TRYON_CLOSED') {
        closeWidget();
        window.removeEventListener('message', handler);
      }
    });
  }

  function closeWidget() {
    const overlay = document.getElementById('aivastra-overlay');
    if (overlay) {
      overlay.remove();
    }
  }

  createStyles();
  window.AIVASTRA_OPEN_WIDGET = openWidget;
})();
