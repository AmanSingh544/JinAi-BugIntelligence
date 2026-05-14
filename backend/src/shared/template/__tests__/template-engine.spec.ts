import { renderTemplate, renderJsonTemplate, getPath } from '../template-engine';

describe('renderTemplate', () => {
  it('substitutes var and bug placeholders', () => {
    const result = renderTemplate('{{var.baseUrl}}/tickets? id={{bug.bugId}}', { baseUrl: 'https://api.com' }, { bugId: '123' });
    expect(result).toBe('https://api.com/tickets? id=123');
  });

  it('replaces missing vars with empty string', () => {
    const result = renderTemplate('{{var.missing}}', {}, {});
    expect(result).toBe('');
  });

  it('ignores unknown namespaces', () => {
    const result = renderTemplate('{{other.thing}}', {}, {});
    expect(result).toBe('{{other.thing}}');
  });
});

describe('renderJsonTemplate', () => {
  it('substitutes inside nested JSON string values', () => {
    const template = {
      title: '{{bug.summary}}',
      meta: { id: '{{bug.bugId}}' },
      tags: ['{{var.env}}'],
      count: 42,
      active: true,
      empty: null,
    };
    const result = renderJsonTemplate(template, { env: 'prod' }, { summary: 'Crash', bugId: '456' }) as Record<string, unknown>;
    expect(result.title).toBe('Crash');
    expect((result.meta as Record<string, unknown>).id).toBe('456');
    expect((result.tags as string[])[0]).toBe('prod');
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.empty).toBeNull();
  });

  it('does not mutate original template', () => {
    const template = { title: '{{bug.summary}}' };
    renderJsonTemplate(template, {}, { summary: 'X' });
    expect(template.title).toBe('{{bug.summary}}');
  });
});

describe('getPath', () => {
  it('extracts dot path', () => {
    expect(getPath({ data: { id: 'abc' } }, 'data.id')).toBe('abc');
  });

  it('extracts bracket index', () => {
    expect(getPath({ items: [{ id: '1' }, { id: '2' }] }, 'items[1].id')).toBe('2');
  });

  it('returns undefined for missing path', () => {
    expect(getPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
});
