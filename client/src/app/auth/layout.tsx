export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return <main className="flex flex-1 flex-col bg-background">{children}</main>;
}
