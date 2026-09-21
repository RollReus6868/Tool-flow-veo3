// ============================================================================
//  main-world-helpers.js — trích NGUYÊN VĂN từ background.js của tiện ích 1.10.0
//  --------------------------------------------------------------------------
//  Hai hàm này vốn được background tiêm vào main world qua
//  chrome.scripting.executeScript({ world: 'MAIN' }). Ở bản desktop, engine đã
//  nằm sẵn trong main world nên chỉ cần chạy thẳng bằng executeJavaScript —
//  giữ nguyên logic dò DOM để không làm hỏng thứ vốn đã chạy được.
// ============================================================================

function mainWorldClickCreate() {
    try {
        let btn = null;

        const newBtn = document.querySelector('button.generate-icon-button');
        if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
            btn = newBtn;
        }

        if (!btn) {
            let editorEl = null;
            const allEditors = document.querySelectorAll(
                '.ProseMirror[contenteditable="true"], ' +
                'div[data-slate-editor="true"][aria-multiline="true"], ' +
                'div[data-slate-editor="true"][zindex="-1"]'
            );
            for (const ed of allEditors) {
                if (!ed.closest('[role="article"]') && ed.offsetParent !== null) { editorEl = ed; break; }
            }

            if (editorEl) {
                let container = editorEl.parentElement;
                for (let i = 0; i < 15 && container && !btn; i++) {
                    const iconEls = container.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon');
                    for (const icon of iconEls) {
                        if (icon.textContent.trim() === 'arrow_forward') {
                            const candidate = icon.closest('button');
                            if (candidate && candidate.offsetParent !== null) { btn = candidate; break; }
                        }
                    }
                    container = container.parentElement;
                }
            }

            if (!btn) {
                const iconEls = document.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon');
                for (const icon of iconEls) {
                    if (icon.textContent.trim() === 'arrow_forward') {
                        const candidate = icon.closest('button');
                        if (candidate && candidate.offsetParent !== null && !candidate.closest('[role="article"]')) {
                            btn = candidate; break;
                        }
                    }
                }
            }
        }

        if (!btn) return { ok: false, error: 'Create button not found' };

        const style = window.getComputedStyle(btn);
        const isDisabled = btn.disabled ||
            btn.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none' ||
            parseFloat(style.opacity) < 0.5;

        // Chỉ dùng MỘT cơ chế click: nếu bắn cả .click() + MouseEvent + Keyboard
        // thì Flow submit 3-4 lần cho cùng một prompt.
        let reactClicked = false;
        try {
            const invokeReact = (el) => {
                for (const key in el) {
                    if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
                        const props = el[key];
                        if (props && typeof props.onClick === 'function') {
                            props.onClick({
                                preventDefault() {}, stopPropagation() {},
                                nativeEvent: { isTrusted: true }, isTrusted: true,
                                type: 'click', target: el, currentTarget: el
                            });
                            reactClicked = true;
                            return true;
                        }
                    }
                }
                return false;
            };
            if (!invokeReact(btn)) {
                const iconEl = btn.querySelector('i, svg, mat-icon');
                if (iconEl) invokeReact(iconEl);
            }
        } catch (e) { /* noop */ }

        if (!reactClicked) {
            btn.focus();
            btn.click();
        }

        return { ok: true, wasDisabled: isDisabled, method: reactClicked ? 'react-fiber-onClick' : 'native-click' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function mainWorldRenameInput(nameToSet) {
    try {
        const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };

        // Flow 2025 dùng Angular Material CDK overlay; bản cũ dùng Radix portal.
        // Phải quét CẢ HAI, nếu không rename luôn thất bại trên UI mới.
        const OVERLAY_SELECTORS = [
            '[data-radix-popper-content-wrapper]',
            '.cdk-overlay-pane',
            '.mat-mdc-menu-panel',
            '.mat-mdc-dialog-container',
            '[role="dialog"]',
            '[role="menu"]'
        ];
        const overlays = [];
        for (const sel of OVERLAY_SELECTORS) {
            document.querySelectorAll(sel).forEach(el => { if (!overlays.includes(el)) overlays.push(el); });
        }

        let input = null;
        let inputDebug = '';

        for (const ov of overlays) {
            const candidate = ov.querySelector('input[type="text"], input:not([type]), textarea');
            if (candidate && isVisible(candidate)) {
                input = candidate;
                inputDebug = `overlay:${ov.className || ov.tagName}`;
                break;
            }
        }

        if (!input) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && isVisible(activeEl)) {
                input = activeEl;
                inputDebug = 'activeElement';
            }
        }

        if (!input) {
            const candidates = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
                .filter(isVisible)
                .filter(inp => inp.getBoundingClientRect().top > 100)
                .filter(inp => {
                    const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                    const al = (inp.getAttribute('aria-label') || '').toLowerCase();
                    const bad = ['search', 'tìm kiếm', 'tim kiem'];
                    return !bad.some(w => ph.includes(w) || al.includes(w));
                });
            if (candidates.length > 0) {
                input = candidates[0];
                inputDebug = 'below-header';
            }
        }

        if (!input) return { ok: false, error: 'Không tìm thấy ô nhập tên (rename input)' };

        const container = overlays.find(ov => ov.contains(input)) || input.parentElement;

        // React/Angular chỉ hiện nút ✓ khi có hover -> dùng chính handler của
        // framework, không spam native event (gây treo UI).
        let el = input.parentElement;
        while (el && el !== document.body) {
            const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
            if (pk) {
                const rp = el[pk];
                const opts = { bubbles: false, cancelable: true, type: 'pointerenter' };
                if (rp?.onPointerEnter) rp.onPointerEnter(opts);
                else if (rp?.onMouseEnter) rp.onMouseEnter({ ...opts, type: 'mouseenter' });
            }
            try { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } catch (_) {}
            if (el === container) break;
            el = el.parentElement;
        }
        await new Promise(r => setTimeout(r, 300));

        const ir = input.getBoundingClientRect();
        const cOpts = {
            view: window, bubbles: true, cancelable: true,
            clientX: ir.left + ir.width - 8, clientY: ir.top + ir.height / 2
        };
        input.dispatchEvent(new PointerEvent('pointerdown', { ...cOpts, button: 0, buttons: 1 }));
        input.dispatchEvent(new MouseEvent('mousedown', { ...cOpts, button: 0, buttons: 1 }));
        input.focus();
        input.dispatchEvent(new PointerEvent('pointerup', { ...cOpts, button: 0, buttons: 0 }));
        input.dispatchEvent(new MouseEvent('mouseup', { ...cOpts, button: 0, buttons: 0 }));
        input.dispatchEvent(new MouseEvent('click', { ...cOpts, button: 0, buttons: 0 }));
        await new Promise(r => setTimeout(r, 180));

        let method = '';
        try {
            input.select();
            const ok = document.execCommand('insertText', false, nameToSet);
            await new Promise(r => setTimeout(r, 180));
            if (ok && input.value === nameToSet) method = 'execCommand';
        } catch (_) {}

        if (!method) {
            const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) nativeSetter.call(input, nameToSet);
            else input.value = nameToSet;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nameToSet }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 180));
            method = 'nativeSetter';
        }

        if (input.value !== nameToSet) {
            return { ok: false, error: `Không đặt được giá trị (hiện tại: "${input.value}")` };
        }

        // --- Xác nhận: tìm nút ✓ / Lưu trong cùng overlay ---
        let confirmed = false;
        let confirmVia = '';
        const scope = container || document;
        const btns = Array.from(scope.querySelectorAll('button, [role="button"]'));

        for (const b of btns) {
            b.style.setProperty('opacity', '1', 'important');
            b.style.setProperty('visibility', 'visible', 'important');
            b.style.setProperty('pointer-events', 'auto', 'important');
        }

        let targetBtn = null;
        for (const b of btns) {
            const txt = (b.textContent || '').trim().toLowerCase();
            const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
            if (['check', 'done', 'check_circle', 'lưu', 'luu', 'save', 'ok', 'xong'].includes(txt)) {
                targetBtn = b; confirmVia = `text:${txt}`; break;
            }
            if (/confirm|save|rename|đổi tên|doi ten|lưu|apply/.test(lbl)) {
                targetBtn = b; confirmVia = `aria:${lbl}`; break;
            }
            const icon = b.querySelector('i, mat-icon, .google-symbols');
            const it = icon ? (icon.textContent || '').trim().toLowerCase() : '';
            if (it === 'check' || it === 'done' || it === 'check_circle') {
                targetBtn = b; confirmVia = `icon:${it}`; break;
            }
        }

        if (!targetBtn) {
            const inputRight = input.getBoundingClientRect().right;
            for (const b of btns) {
                const r = b.getBoundingClientRect();
                if (r.width > 0 && r.left > inputRight - 6) { targetBtn = b; confirmVia = 'position-right'; break; }
            }
        }

        if (targetBtn) {
            try { targetBtn.click(); confirmed = true; await new Promise(r => setTimeout(r, 350)); }
            catch (e) { confirmVia = `click-error:${e.message}`; }
        }

        if (!confirmed) {
            // Enter là fallback cuối: nhiều dialog rename của Flow submit bằng Enter.
            for (const type of ['keydown', 'keypress', 'keyup']) {
                input.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
            }
            confirmVia = 'fallback-enter';
            await new Promise(r => setTimeout(r, 350));
            confirmed = true;
        }

        return { ok: true, method, inputDebug, confirmed, confirmVia, value: nameToSet };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// Phơi ra để tiến trình chính gọi được qua executeJavaScript.
window.__flowClickCreate = mainWorldClickCreate;
window.__flowRenameInput = mainWorldRenameInput;
