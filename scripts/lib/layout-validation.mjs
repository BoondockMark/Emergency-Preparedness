const round = value => Math.round(value * 100) / 100;

function box(rect) {
  return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height), right: round(rect.right), bottom: round(rect.bottom) };
}

export async function inspectSheetGeometry(page, handoutCode) {
  return page.$$eval('.sheet', (sheets, code) => {
    const tolerance = 0.5;
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const selector = element => {
      const parts = [];
      for (let node = element; node?.nodeType === Node.ELEMENT_NODE && !node.classList.contains('sheet'); node = node.parentElement) {
        let part = node.localName;
        if (node.id) part += `#${CSS.escape(node.id)}`;
        else if (node.classList.length) part += [...node.classList].map(name => `.${CSS.escape(name)}`).join('');
        else if (node.parentElement) {
          const peers = [...node.parentElement.children].filter(peer => peer.localName === node.localName);
          if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
        }
        parts.unshift(part);
      }
      return parts.join(' > ') || ':scope';
    };
    const outside = (inner, outer) => inner.left < outer.left - tolerance || inner.right > outer.right + tolerance || inner.top < outer.top - tolerance || inner.bottom > outer.bottom + tolerance;

    return sheets.flatMap((sheet, pageIndex) => {
      const issues = [];
      const sheetBox = rect(sheet);
      const content = sheet.querySelector('.content');
      const contentBox = rect(content);
      const footer = content.querySelector(':scope > .footer');
      const footerBox = footer ? rect(footer) : null;
      const authoredChildren = [...content.children].filter(element =>
        element !== footer && element.hasAttribute('data-source-path')
      );
      const printableBottom = footerBox?.top ?? contentBox.bottom;
      const firstBottomOverflow = authoredChildren.find(element => rect(element).bottom > printableBottom + tolerance);
      const precedingHeading = firstBottomOverflow
        ? authoredChildren.slice(0, authoredChildren.indexOf(firstBottomOverflow) + 1)
          .findLast(element => /^H[23]$/.test(element.tagName))
        : null;
      const likelyCause = firstBottomOverflow ? {
        selector: selector(firstBottomOverflow),
        sourcePath: firstBottomOverflow.dataset.sourcePath,
        sourceLine: Number(firstBottomOverflow.dataset.sourceLine),
        overflowPixels: Math.round((rect(firstBottomOverflow).bottom - printableBottom) * 100) / 100,
        boundary: footerBox ? 'footer' : 'printable region',
        suggestedBreak: precedingHeading ? {
          selector: selector(precedingHeading),
          sourcePath: precedingHeading.dataset.sourcePath,
          sourceLine: Number(precedingHeading.dataset.sourceLine)
        } : undefined
      } : undefined;
      const overflowSource = axis => [...content.querySelectorAll('[data-source-path][data-source-line]')]
        .reduce((candidate, element) => {
          if (!candidate) return element;
          const current = rect(element);
          const previous = rect(candidate);
          return (axis === 'horizontal' ? current.right > previous.right : current.bottom > previous.bottom) ? element : candidate;
        }, null);
      const add = (type, element, measured, region, detail) => {
        const axis = type === 'horizontal-overflow' ? 'horizontal'
          : type === 'vertical-overflow' ? 'vertical'
          : measured.right > region.right + tolerance || measured.left < region.left - tolerance
          ? 'horizontal'
          : measured.bottom > region.bottom + tolerance || measured.top < region.top - tolerance
            ? 'vertical'
            : undefined;
        const source = element.closest?.('[data-source-path][data-source-line]')
          ?? (element === sheet && axis ? overflowSource(axis) : element.querySelector?.('[data-source-path][data-source-line]'));
        issues.push({
          code, page: pageIndex + 1, type, selector: selector(element), bounds: measured, region, detail, axis,
          sourcePath: source?.dataset.sourcePath,
          sourceLine: source?.dataset.sourceLine ? Number(source.dataset.sourceLine) : undefined,
          likelyCause: element === sheet && type === 'vertical-overflow' ? likelyCause : undefined
        });
      };

      if (sheet.scrollWidth > sheet.clientWidth + tolerance) add('horizontal-overflow', sheet, sheetBox, sheetBox, `scrollWidth ${sheet.scrollWidth}px exceeds clientWidth ${sheet.clientWidth}px`);
      if (sheet.scrollHeight > sheet.clientHeight + tolerance) add('vertical-overflow', sheet, sheetBox, sheetBox, `scrollHeight ${sheet.scrollHeight}px exceeds clientHeight ${sheet.clientHeight}px`);

      for (const element of content.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const measured = rect(element);
        if (element !== footer && !footer?.contains(element) && outside(measured, contentBox)) add('outside-printable-region', element, measured, contentBox);
        if (footerBox && element !== footer && !footer.contains(element) && measured.bottom > footerBox.top - tolerance && measured.top < footerBox.bottom + tolerance) add('footer-overlap', element, measured, footerBox);

        for (let ancestor = element.parentElement; ancestor && ancestor !== sheet; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(ancestorStyle.overflowX);
          const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(ancestorStyle.overflowY);
          const ancestorBox = rect(ancestor);
          if ((clipsX && (measured.left < ancestorBox.left - tolerance || measured.right > ancestorBox.right + tolerance)) ||
              (clipsY && (measured.top < ancestorBox.top - tolerance || measured.bottom > ancestorBox.bottom + tolerance))) {
            add('clipped-element', element, measured, ancestorBox, `clipped by ${selector(ancestor)}`);
            break;
          }
        }
        if (element.scrollWidth > element.clientWidth + tolerance) add('horizontal-overflow', element, measured, measured, `scrollWidth ${element.scrollWidth}px exceeds clientWidth ${element.clientWidth}px`);
      }
      return issues;
    });
  }, handoutCode).then(issues => issues.map(issue => ({ ...issue, bounds: box(issue.bounds), region: box(issue.region) })));
}

export function formatLayoutIssue(issue) {
  const location = issue.sourcePath && issue.sourceLine ? ` (${issue.sourcePath}:${issue.sourceLine})` : '';
  const horizontal = issue.type === 'horizontal-overflow' || issue.axis === 'horizontal';
  const remediation = horizontal
    ? 'Break or shorten long unbroken text, or reduce the element width.'
    : 'Shorten the content or add a page break.';
  const cause = issue.likelyCause;
  const causeLocation = cause?.sourcePath && cause?.sourceLine
    ? `${cause.sourcePath}:${cause.sourceLine}`
    : undefined;
  const breakLocation = cause?.suggestedBreak?.sourcePath && cause?.suggestedBreak?.sourceLine
    ? `${cause.suggestedBreak.sourcePath}:${cause.suggestedBreak.sourceLine}`
    : undefined;
  const explanation = cause
    ? `\n  Likely cause: ${cause.selector} at ${causeLocation ?? 'an unannotated generated element'} is the first block that does not fit (${cause.overflowPixels}px past the ${cause.boundary} boundary).${breakLocation ? ` Inspect the section beginning at ${breakLocation} (${cause.suggestedBreak.selector}) as a likely place for a page break.` : ''}`
    : '';
  return `${issue.code} page ${issue.page}${location}: ${issue.type} at ${issue.selector}; bounds=${JSON.stringify(issue.bounds)} region=${JSON.stringify(issue.region)}${issue.detail ? ` (${issue.detail})` : ''}.${explanation} Remedy: ${remediation}`;
}
