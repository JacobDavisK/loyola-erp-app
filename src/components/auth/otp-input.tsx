"use client";

import { useRef } from "react";

/**
 * Six single-digit boxes that behave like one field: typing moves forward, Backspace moves back,
 * arrow keys / Home / End move freely, and pasting a whole code fills every box.
 */
export function OtpInput({ value, onChange, onComplete, invalid, disabled, length = 6, describedBy, label = "Verification code" }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; invalid?: boolean; disabled?: boolean; length?: number; describedBy?: string; label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();
  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="grid grid-cols-6 gap-2 sm:gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="otp-cell"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={i === 0 ? length : 1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          data-filled={d !== "" || undefined}
          disabled={disabled}
          value={d}
          autoFocus={i === 0}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return;
            // A whole code (phone autofill into the first box) fills everything; otherwise keep the newest digit.
            if (typed.length > 1 && typed.length >= length - i - 1) { set(value.slice(0, i) + typed); focus(i + typed.length); return; }
            const arr = digits.slice();
            arr[i] = typed.slice(-1);
            set(arr.join(""));
            focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const arr = digits.slice();
              if (arr[i]) { arr[i] = ""; onChange(arr.join("")); }
              else if (i > 0) { arr[i - 1] = ""; onChange(arr.join("")); focus(i - 1); }
            } else if (e.key === "ArrowLeft") { e.preventDefault(); focus(i - 1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); focus(i + 1); }
            else if (e.key === "Home") { e.preventDefault(); focus(0); }
            else if (e.key === "End") { e.preventDefault(); focus(length - 1); }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").replace(/\D/g, "");
            if (!text) return;
            e.preventDefault();
            set(text);
            focus(Math.min(text.length, length - 1));
          }}
        />
      ))}
    </div>
  );
}
