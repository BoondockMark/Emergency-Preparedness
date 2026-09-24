const MINIMUM_TEXT_PT = 7.5;
const MINIMUM_BODY_PT = 9;

export async function inspectAccessibility(page, documentCode) {
  return page.evaluate(({ code, minimumTextPt, minimumBodyPt }) => {
    const issues = [];
    const describe = element => {
      if (!element) return 'document';
      if (element.id) return `#${CSS.escape(element.id)}`;
      return element.localName + (element.classList.length ? [...element.classList].map(name => `.${CSS.escape(name)}`).join('') : '');
    };
    const add = (type, element, detail) => issues.push({ code, type, selector: describe(element), detail });
    const luminance = color => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    };
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const background = element => {
      for (let node = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && !color.endsWith(', 0)') && color !== 'transparent') return color;
      }
      return 'rgb(255, 255, 255)';
    };

    for (const element of document.querySelectorAll('h1,h2,h3,p,li,th,td,caption,figcaption,.credit,.kicker,.footer,.edge')) {
      if (!element.textContent.trim()) continue;
      const style = getComputedStyle(element);
      const points = parseFloat(style.fontSize) * .75;
      const ancillary = element.matches('caption,figcaption,.credit,.kicker,.footer');
      const minimum = ancillary ? minimumTextPt : minimumBodyPt;
      if (points + .01 < minimum) add('minimum-text-size', element, `${points.toFixed(2)}pt is below ${minimum}pt`);
      const ratio = contrast(style.color, background(element));
      const large = points >= 18 || (points >= 14 && Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      if (ratio + .01 < required) add('text-contrast', element, `${ratio.toFixed(2)}:1 is below ${required}:1`);
    }

    for (const sheet of document.querySelectorAll('.sheet')) {
      let previous = 0;
      for (const heading of sheet.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        const level = Number(heading.localName.slice(1));
        if (previous && level > previous + 1) add('heading-order', heading, `heading level jumps from h${previous} to h${level}`);
        previous = level;
      }
      if (sheet.querySelectorAll('h1').length !== 1) add('page-title', sheet, 'each sheet must have exactly one h1');
    }

    for (const notice of document.querySelectorAll('.warning')) {
      const marker = getComputedStyle(notice, '::before').content.replace(/^['"]|['"]$/g, '');
      if (!/(DANGER|WARNING|CAUTION)/.test(marker) || !/[!△✕]/.test(marker)) add('color-only-warning', notice, 'severity needs a visible word and non-color symbol');
    }
    for (const figure of document.querySelectorAll('figure')) {
      const caption = figure.querySelector(':scope > figcaption');
      if (!caption) add('figure-caption', figure, 'meaningful figures require an adjacent figcaption');
      else if (figure.getAttribute('aria-labelledby') !== caption.id || !caption.id) add('figure-caption-relationship', figure, 'figure aria-labelledby must reference its caption id');
    }
    for (const table of document.querySelectorAll('table')) {
      if (!table.querySelector(':scope > caption')) add('table-caption', table, 'data tables require a caption');
      for (const heading of table.querySelectorAll('th')) if (!heading.hasAttribute('scope')) add('table-heading', heading, 'table headings require scope');
    }
    return issues;
  }, { code: documentCode, minimumTextPt: MINIMUM_TEXT_PT, minimumBodyPt: MINIMUM_BODY_PT });
}

export function formatAccessibilityIssue(issue) {
  return `${issue.code}: ${issue.type} at ${issue.selector} (${issue.detail})`;
}
