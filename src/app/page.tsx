import { redirect } from "next/navigation";

/** Single server-side hop into the app shell (happens once, before hydration). */
export default function Home() {
  redirect("/app");
}
