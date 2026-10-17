import { redirect } from "next/navigation";

// The analytics overview arrives with the dashboards release; orders is the working home until then.
export default function AdminIndex() {
  redirect("/admin/orders");
}
