import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedLinkUrl, sourceLinks, sourceLinkSelection, linkOpeningWithUrl, linkOpeningWithoutUrl, escapeLinkText } from '../editor/link-model.js';

test('link addresses allow explicit web, contact and local destinations and reject unsafe or malformed types', () => {
  for (const url of ['https://example.org/a?x=1&y=2#here', 'http://localhost:4174/', 'mailto:editor@example.org?subject=Review', 'tel:+15555551234', '#section', '../guide.html', './next.html', '/docs/']) assert.equal(checkedLinkUrl(url), url);
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test', '//example.org', 'https://', 'https:example.org', 'https://name:password@example.org', 'https://a/\nb', 'https://a/\\b', 'https://a/%zz', 'example.org', 'mailto:missing', 'mailto:user@host:invalid', 'tel:not-a-number']) assert.throws(() => checkedLinkUrl(url));
  assert.equal(checkedLinkUrl(' https://example.org/*path* '), 'https://example.org/%2Apath%2A');
});

test('source link scanning preserves exact occurrences and excludes metadata, comments and examples', () => {
  const prefix = '---\r\ntitle: "<a href=\'x\'>Hidden</a>"\r\n---\r\n<!-- <a href="x">Comment</a> -->\r\n<pre><a href="x">Code</a></pre>\r\n```\r\n<a href="x">Fence</a>\r\n```\r\n';
  const link = '<a title="a > b" href="https://example.org"><strong>Same</strong></a>';
  const source = prefix + link + ' and ' + link;
  const { links } = sourceLinks(source);
  assert.equal(links.length, 2);
  assert.equal(links[0].start, prefix.length);
  assert.equal(links[1].start, prefix.length + link.length + 5);
  assert.equal(source.slice(links[0].start, links[0].end), link);
  assert.deepEqual(sourceLinkSelection(source, links[1].openEnd, links[1].openEnd + 2), links[1]);
  assert.throws(() => sourceLinkSelection(source, 5, 5), /body/);
  assert.throws(() => sourceLinkSelection(source, source.indexOf('Comment'), source.indexOf('Comment') + 1), /plain text/);
  assert.throws(() => sourceLinkSelection('<a href="x">Unclosed', 15, 16), /plain text/);
});

test('updating a link preserves unrelated attributes and escapes text without introducing markup', () => {
  const original = '<a id="topic" title=\'href="leave this"\' HREF = \'old\' class="reference">';
  assert.equal(linkOpeningWithUrl(original, 'https://example.org/?a=1&b=2'), '<a id="topic" title=\'href="leave this"\' href="https://example.org/?a=1&amp;b=2" class="reference">');
  assert.equal(linkOpeningWithoutUrl(original), '<a id="topic" title=\'href="leave this"\' class="reference">');
  assert.equal(linkOpeningWithUrl('<a id="anchor">', '#other'), '<a id="anchor" href="#other">');
  assert.throws(() => linkOpeningWithUrl('<a href="a" href="b">', '#target'), /repeated/);
  assert.equal(escapeLinkText('Cell | value'), 'Cell &#124; value');
  assert.throws(() => sourceLinkSelection('<a href="unfinished', 12, 13), /incomplete HTML/);
  assert.equal(escapeLinkText('<script> * & "'), '&lt;script&gt; &#42; &amp; &quot;');
});
