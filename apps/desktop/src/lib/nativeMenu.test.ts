import { describe, expect, it } from "vitest";
import { allowsNativeMenu, shouldSuppressNativeMenu } from "./nativeMenu";

/** Build a DOM fragment and hand back the node to right-click. */
function target(html: string, selector: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector(selector)!;
}

describe("allowsNativeMenu", () => {
  it("keeps the page menu in editable fields — Paste and Look Up matter there", () => {
    expect(allowsNativeMenu(target("<textarea></textarea>", "textarea"))).toBe(true);
    expect(allowsNativeMenu(target("<input />", "input"))).toBe(true);
    expect(
      allowsNativeMenu(target('<div contenteditable="true"><b id="x">hi</b></div>', "#x")),
    ).toBe(true);
  });

  it("keeps it inside document content, however deeply nested", () => {
    const el = target(
      '<div data-native-menu><article><p><em id="deep">a word</em></p></article></div>',
      "#deep",
    );
    expect(allowsNativeMenu(el)).toBe(true);
  });

  it("withholds it on chrome — a sidebar row is a link only incidentally", () => {
    // What the user hit: right-clicking a session offered "Open Link in New
    // Window" and "Download Linked File".
    const row = target('<aside><a href="/live/s1" id="row">a session</a></aside>', "#row");
    expect(allowsNativeMenu(row)).toBe(false);
  });

  it("withholds it on a Screen tab, whose name used to get selected", () => {
    const tab = target('<div class="tabs"><span id="tab">Screen 1</span></div>', "#tab");
    expect(allowsNativeMenu(tab)).toBe(false);
  });

  it("handles a text node target and a missing target without throwing", () => {
    const p = target("<div data-native-menu><p id=t>words</p></div>", "#t");
    expect(allowsNativeMenu(p.firstChild)).toBe(true); // the text node itself
    expect(allowsNativeMenu(null)).toBe(false);
    expect(allowsNativeMenu(window)).toBe(false);
  });

  it("treats a read-only contenteditable as chrome, not a field", () => {
    const el = target('<div contenteditable="false"><span id="x">x</span></div>', "#x");
    expect(allowsNativeMenu(el)).toBe(false);
  });
});

describe("shouldSuppressNativeMenu", () => {
  it("stands down once a component has handled the right-click", () => {
    // Radix opens its menu AND preventDefaults. Suppressing on top of that is
    // harmless, but doing it FIRST makes Radix skip its own handler — which
    // left sessions, projects and Screen tabs with no menu at all.
    const chrome = target('<div><span id="c">Screen 1</span></div>', "#c");
    expect(shouldSuppressNativeMenu({ target: chrome, defaultPrevented: true })).toBe(false);
    expect(shouldSuppressNativeMenu({ target: chrome, defaultPrevented: false })).toBe(true);
  });

  it("never suppresses inside a field or document content", () => {
    const field = target("<textarea></textarea>", "textarea");
    expect(shouldSuppressNativeMenu({ target: field, defaultPrevented: false })).toBe(false);
    const doc = target('<div data-native-menu><p id="d">text</p></div>', "#d");
    expect(shouldSuppressNativeMenu({ target: doc, defaultPrevented: false })).toBe(false);
  });
});
