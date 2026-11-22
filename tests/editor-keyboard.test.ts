import { describe, expect, it } from 'vitest';
import { isTypingTarget } from '../src/editor/state/keyboard';

interface FakeElement {
  tagName: string;
  isContentEditable: boolean;
  type?: string;
  closest(selector: string): FakeElement | null;
}

function element(
  tagName: string,
  options: { editable?: boolean; noShortcuts?: boolean; type?: string } = {},
): FakeElement {
  const self: FakeElement = {
    tagName,
    isContentEditable: options.editable ?? false,
    type: options.type,
    closest: (selector: string) => (options.noShortcuts && selector === '[data-no-shortcuts]' ? self : null),
  };
  return self;
}

describe('isTypingTarget', () => {
  it('detects form fields', () => {
    expect(isTypingTarget(element('INPUT'))).toBe(true);
    expect(isTypingTarget(element('input'))).toBe(true);
    expect(isTypingTarget(element('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(element('INPUT', { type: 'number' }))).toBe(true);
    expect(isTypingTarget(element('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(element('INPUT', { type: 'password' }))).toBe(true);
    expect(isTypingTarget(element('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(element('SELECT'))).toBe(true);
  });

  it('ignores non-text inputs', () => {
    expect(isTypingTarget(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'radio' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'range' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'color' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'button' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'submit' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'file' }))).toBe(false);
  });

  it('detects contentEditable hosts', () => {
    expect(isTypingTarget(element('DIV', { editable: true }))).toBe(true);
  });

  it('detects descendants of data-no-shortcuts', () => {
    expect(isTypingTarget(element('SPAN', { noShortcuts: true }))).toBe(true);
  });

  it('ignores ordinary elements and missing targets', () => {
    expect(isTypingTarget(element('DIV'))).toBe(false);
    expect(isTypingTarget(element('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});
