import { useState } from "react";
import { useExhibitPicker, ExhibitPickerDropdown, getChamberIcon } from "@congress/exhibit-ui";

// The dropdown only opens when useExhibitPicker detects an unterminated "[["
// immediately before the caret (see useExhibitPicker.ts's post-commit effect:
// it reads element.selectionStart and looks backward from there for the last
// unterminated "[["). Landing that open on first paint (a static screenshot,
// nobody around to type) needs two things, not just a pre-filled value ending
// in "[[":
//   1. the field focused, since the effect bails when it isn't
//         document.activeElement.
//   2. the caret explicitly moved to the end of the value.
// #2 is the non-obvious part: a plain `autoFocus` on a textarea that already
// has a value does NOT put the caret at the end - Chrome leaves
// selectionStart/End at 0 for a value the user never typed into, so the
// hook's "text before the cursor" scan sees an empty prefix and never finds
// the trigger at all. Fixing this needs a manual `el.setSelectionRange(...)`
// in a ref callback (which runs at commit time, before the hook's own effect
// reads the selection), not just the autoFocus attribute.
function useOpenPickerRef(content: string, attachPickerRef: (el: HTMLTextAreaElement | null) => void) {
  return (el: HTMLTextAreaElement | null) => {
    if (el) {
      el.focus();
      el.setSelectionRange(content.length, content.length);
    }
    attachPickerRef(el);
  };
}

export function OpenBrowsingAll() {
  const [content, setContent] = useState("Discussed rollout plan with [[");
  const picker = useExhibitPicker({ value: content, onChange: setContent });
  const ref = useOpenPickerRef(content, picker.fieldProps.ref);

  return (
    <div className="exhibit-field" style={{ width: "22rem" }}>
      <textarea
        {...picker.fieldProps}
        ref={ref}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
      <ExhibitPickerDropdown picker={picker} renderIcon={getChamberIcon} className="exhibit-picker-dropdown" />
    </div>
  );
}

export function OpenWithQuery() {
  const [content, setContent] = useState("See [[budget for the details");
  const picker = useExhibitPicker({ value: content, onChange: setContent });
  const ref = useOpenPickerRef(content, picker.fieldProps.ref);

  return (
    <div className="exhibit-field" style={{ width: "22rem" }}>
      <textarea
        {...picker.fieldProps}
        ref={ref}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="w-full border border-dust bg-parchment p-3 font-mono text-base text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
      <ExhibitPickerDropdown picker={picker} renderIcon={getChamberIcon} className="exhibit-picker-dropdown" />
    </div>
  );
}
