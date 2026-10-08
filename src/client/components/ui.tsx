import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previously = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>("input, select, textarea, button");
    focusable?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previously?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Mix({
  labor,
  equipment,
  material,
  subcontractor,
}: {
  labor: number;
  equipment: number;
  material: number;
  subcontractor: number;
}) {
  const total = labor + equipment + material + subcontractor;
  if (total <= 0) return <div className="mix" aria-hidden="true" />;
  const width = (value: number) => `${(value / total) * 100}%`;
  return (
    <div className="mix" aria-hidden="true">
      <i className="labor" style={{ width: width(labor) }} />
      <i className="equip" style={{ width: width(equipment) }} />
      <i className="mat" style={{ width: width(material) }} />
      <i className="sub" style={{ width: width(subcontractor) }} />
    </div>
  );
}

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M7 22.5 16 8l9 14.5" fill="none" stroke="#e3a56a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.2 17.5h11.6" fill="none" stroke="#e3a56a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
