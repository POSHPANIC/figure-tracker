"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SuggestOption = { value: string; note?: string };

function rank(option: string, typed: string): number {
  const o = option.toLowerCase();
  return o === typed ? 2 : o.startsWith(typed) ? 1 : 0;
}

/**
 * A text input with a dropdown of suggestions under it.
 *
 * Suggestions come from a fixed list (scales, currencies) or are fetched as
 * the person types (manufacturers, characters). With `multiple`, the field is
 * a comma-separated list and only the name after the last comma is suggested
 * for, so picking one does not overwrite the names already typed.
 *
 * Arrow keys move through the list, Enter picks, Escape closes. Enter only
 * picks while the list is open; otherwise it submits the form as usual.
 */
export function SuggestInput({
  name,
  defaultValue,
  options,
  fetchOptions,
  multiple = false,
  className,
  inputProps,
}: {
  name: string;
  defaultValue: string;
  options?: readonly string[];
  fetchOptions?: (query: string) => Promise<SuggestOption[]>;
  multiple?: boolean;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  // Fetched answers are kept with the text they answer, so a list is only
  // shown for what is in the box now.
  const [fetched, setFetched] = useState<{ query: string; items: SuggestOption[] }>({ query: "", items: [] });
  // Likewise the highlighted row, which starts at the top for each new text.
  const [cursor, setCursor] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const listId = useId();
  const request = useRef(0);

  // The part being typed: everything, or what follows the last comma.
  const token = (multiple ? value.slice(value.lastIndexOf(",") + 1) : value).trim();

  // A fixed list is filtered as you type, with no state to keep in step.
  const fromList = useMemo((): SuggestOption[] => {
    if (!options || !token) return [];
    const t = token.toLowerCase();
    return options
      .filter((o) => o.toLowerCase().includes(t))
      // Exactly what was typed first, then what starts with it, then the rest,
      // each in the list's own order (most used first).
      .sort((a, b) => rank(b, t) - rank(a, t))
      .slice(0, 8)
      .map((v) => ({ value: v }));
  }, [options, token]);

  useEffect(() => {
    if (!open || options || !fetchOptions || !token) return;
    // Debounced, and only the latest answer is kept: a slow reply for "Go"
    // must not replace the list for "Good Smile".
    const id = ++request.current;
    const timer = setTimeout(async () => {
      const hits = await fetchOptions(token).catch(() => []);
      if (id === request.current) setFetched({ query: token, items: hits });
    }, 150);
    return () => clearTimeout(timer);
  }, [token, open, options, fetchOptions]);

  const items = options ? fromList : fetched.query === token ? fetched.items : [];
  // Nothing to suggest when the only match is already what is typed.
  const shown = items.length === 1 && items[0].value.toLowerCase() === token.toLowerCase() ? [] : items;
  const visible = open && shown.length > 0;
  const highlight = cursor.query === token ? Math.min(cursor.index, Math.max(shown.length - 1, 0)) : 0;
  const setHighlight = (next: (i: number) => number) => setCursor({ query: token, index: next(highlight) });

  function pick(option: SuggestOption) {
    if (multiple) {
      const before = value.slice(0, value.lastIndexOf(",") + 1);
      setValue(before ? `${before.trimEnd()} ${option.value}` : option.value);
    } else {
      setValue(option.value);
    }
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        {...inputProps}
        name={name}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {visible && (
        <ul id={listId} role="listbox" className="term-panel absolute z-50 mt-1 max-h-72 w-full overflow-y-auto overscroll-contain">
          {shown.map((option, i) => (
            <li key={`${option.value}:${option.note ?? ""}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // Before the input's blur, which would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setHighlight(() => i)}
                data-active={i === highlight}
                className={cn("term-item flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm")}
              >
                <span className="min-w-0 truncate">{option.value}</span>
                {option.note && <span className="shrink-0 truncate text-xs opacity-70">{option.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
