"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateProfile } from "@/lib/actions/profile";

type Props = {
  initial: {
    name: string;
    username: string;
    bio: string;
    publicProfile: boolean;
  };
};

export function SettingsForm({ initial }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [username, setUsername] = useState(initial.username);
  const [isPublic, setIsPublic] = useState(initial.publicProfile);

  function submit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfile(formData);
      if (result.ok) {
        // Refresh the session token so the header picks up a changed username
        // without requiring a sign-out.
        await update();
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={submit} className="space-y-5">
      <Field label="Display name" hint="Shown on your public profile.">
        <input
          type="text"
          name="name"
          defaultValue={initial.name}
          maxLength={60}
          placeholder="Your name"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
        />
      </Field>

      <Field
        label="Username"
        hint={
          username
            ? `Your profile will live at /u/${username}`
            : "Lowercase letters, numbers and underscores. 3–20 characters."
        }
      >
        <input
          type="text"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          maxLength={20}
          pattern="[a-z0-9_]{3,20}"
          placeholder="yourname"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
        />
      </Field>

      <Field label="Bio" hint="A sentence or two about what you collect.">
        <textarea
          name="bio"
          defaultValue={initial.bio}
          maxLength={300}
          rows={3}
          placeholder="Scale figures, mostly Fate and Chainsaw Man."
          className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3">
        <input
          type="checkbox"
          name="publicProfile"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-sm font-medium">Make my profile public</span>
          <span className="mt-0.5 block text-xs text-muted">
            Anyone with the link can see which figures you own and their market value. What you
            paid and your gain/loss stay private either way.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="flex items-center gap-1.5 rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">
          <Check className="size-4" /> Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Save changes
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
