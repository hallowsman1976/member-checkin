import { Loader2, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

const loginSchema = z.object({
  email: z.email('กรุณากรอกอีเมลให้ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

export function LoginPage() {
  const { session, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (!isLoading && session) return <Navigate to={from} replace />

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const parsed = loginSchema.safeParse({ email: form.get('email'), password: form.get('password') })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword(parsed.data)
    setSubmitting(false)
    if (error) {
      toast.error(error.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <p className="text-sm text-muted">สหกรณ์ออมทรัพย์สาธารณสุขจังหวัดมุกดาหาร จำกัด</p>
          <CardTitle className="text-xl text-primary">Smart Member Check-in 2569</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">อีเมล</Label>
              <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogIn className="size-5" aria-hidden />}
              เข้าสู่ระบบ
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
