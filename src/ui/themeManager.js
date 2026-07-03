/**
 * Theme Manager - Applies light/dark styling to the popup based on the
 * active Firefox theme, falling back to the system color scheme.
 */

class ThemeManager {
  async init() {
    await this.detectAndApplyTheme();
    this.setupThemeListeners();
  }

  /**
   * Detect and apply the theme. Never throws - it is also invoked from
   * change listeners, where a rejection would leave the theme stale.
   */
  async detectAndApplyTheme() {
    let isDark;

    try {
      if (browser.theme?.getCurrent) {
        const themeInfo = await browser.theme.getCurrent();
        isDark = this.isDarkTheme(themeInfo);
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (error) {
      console.warn('Theme detection failed, using system preference:', error);
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    this.applyTheme(isDark ? 'dark' : 'light');
  }

  /**
   * Judge dark vs light from the theme's chrome colors, most reliable first.
   * Inconclusive themes fall back to the system preference.
   */
  isDarkTheme(themeInfo) {
    const colors = themeInfo?.colors;
    if (colors) {
      for (const color of [colors.toolbar, colors.frame, colors.popup, colors.sidebar]) {
        if (!color) continue;
        const luminance = this.getColorLuminance(color);
        if (luminance < 0.3) return true;
        if (luminance > 0.7) return false;
      }
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Relative luminance (WCAG formula), 0 = darkest, 1 = lightest.
   */
  getColorLuminance(color) {
    const rgb = this.parseColor(color);
    if (!rgb) return 0.5;

    const [r, g, b] = rgb.map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Parse a color string to [r, g, b]; null if unparseable.
   */
  parseColor(color) {
    if (!color) return null;

    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        return [...hex].map(c => parseInt(c + c, 16));
      }
      if (hex.length === 6) {
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      }
    }

    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map(Number);
    }

    // Named colors and other formats: let the browser resolve them.
    try {
      const div = document.createElement('div');
      div.style.color = color;
      div.style.display = 'none';
      document.body.appendChild(div);
      const computed = window.getComputedStyle(div).color;
      document.body.removeChild(div);

      const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return [match[1], match[2], match[3]].map(Number);
      }
    } catch {}

    return null;
  }

  applyTheme(theme) {
    document.body.classList.toggle('dark-theme', theme === 'dark');
  }

  setupThemeListeners() {
    if (browser.theme?.onUpdated) {
      browser.theme.onUpdated.addListener(() => this.detectAndApplyTheme());
    }

    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => this.detectAndApplyTheme());
  }
}

export default new ThemeManager();
