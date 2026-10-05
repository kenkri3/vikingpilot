"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loggInnHandling, type LoginTilstand } from "./actions";

function SendKnapp() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
    >
      {pending ? "Logger inn …" : "Logg inn"}
    </button>
  );
}

export default function LoginSkjema() {
  const [tilstand, handling] = useActionState<LoginTilstand, FormData>(loggInnHandling, {});

  return (
    <form action={handling} className="space-y-4">
      <div>
        <label htmlFor="epost" className="mb-1.5 block text-sm font-medium">
          E-post
        </label>
        <input
          id="epost"
          name="epost"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-md border border-kant bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
      </div>

      <div>
        <label htmlFor="passord" className="mb-1.5 block text-sm font-medium">
          Passord
        </label>
        <input
          id="passord"
          name="passord"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-kant bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
      </div>

      {tilstand.feil ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {tilstand.feil}
        </p>
      ) : null}

      <SendKnapp />
    </form>
  );
}
