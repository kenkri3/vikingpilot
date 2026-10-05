import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Roten peker på dashbordet. Er du ikke innlogget, sender dashbordet deg videre
 * til /login.
 */
export default function Rot() {
  redirect("/dashboard");
}
