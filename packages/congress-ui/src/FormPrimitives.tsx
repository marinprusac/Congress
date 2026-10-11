export function FormLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

export function FormTextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="mb-4 w-full border-2 border-ink bg-paper px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
    />
  );
}

export function FormErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 font-mono text-sm text-alert">{children}</p>;
}

export function FormSubmitButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      {...props}
      className="btn btn--primary"
    >
      {children}
    </button>
  );
}
