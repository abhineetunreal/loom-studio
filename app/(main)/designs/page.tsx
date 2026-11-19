import { redirect } from "next/navigation";

// The /designs route has no index view of its own: the catalog home lives at
// "/" and the design browser is rendered by the (main) layout's left panel.
// Without this page, a direct visit to /designs renders the layout (sidebar)
// but 404s in the main content area. Redirect bare /designs visits to the
// homepage so they resolve to the "select a design" prompt instead.
export default function DesignsIndexPage() {
  redirect("/");
}
