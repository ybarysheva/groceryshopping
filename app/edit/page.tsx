import type { Metadata } from "next";
import EditPage from "@/components/EditPage";

export const metadata: Metadata = { title: "Edit list" };

export default function Edit() {
  return <EditPage />;
}
