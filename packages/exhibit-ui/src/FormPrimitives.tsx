export function FormLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">{children}</label>;
}

export function FormTextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="mb-4 w-full border border-dust bg-parchment px-3 py-2 font-display text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
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
      className="border border-accent px-4 py-2 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-parchment disabled:opacity-50"
    >
      {children}
    </button>
  );
}
