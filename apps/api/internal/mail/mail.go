// Package mail sends transactional email. Resend in production; DevMailer
// locally (writes messages to disk + log, never leaves the machine).
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// Resend sends through https://resend.com's HTTP API.
type Resend struct {
	APIKey string
	From   string // e.g. "MeowSphere <noreply@your-domain>" (domain verified in Resend)
	// Endpoint overrides the API URL (tests).
	Endpoint string
	Client   *http.Client
}

func (r Resend) Send(ctx context.Context, m Message) error {
	endpoint := r.Endpoint
	if endpoint == "" {
		endpoint = "https://api.resend.com/emails"
	}
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{
		"from": r.From, "to": []string{m.To}, "subject": m.Subject, "text": m.Text, "html": m.HTML,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("resend: status %d: %s", res.StatusCode, detail)
	}
	return nil
}

// DevMailer is the local "mailbox": each message is written to Dir as a .txt
// file and logged, so developers can read codes without a real provider.
type DevMailer struct{ Dir string }

func (d DevMailer) Send(_ context.Context, m Message) error {
	if err := os.MkdirAll(d.Dir, 0o700); err != nil {
		return err
	}
	name := fmt.Sprintf("%s_%s.txt", time.Now().Format("20060102-150405.000"), sanitize(m.To))
	content := fmt.Sprintf("To: %s\nSubject: %s\n\n%s\n", m.To, m.Subject, m.Text)
	path := filepath.Join(d.Dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return err
	}
	slog.Info("dev mail (not sent)", "to", m.To, "subject", m.Subject, "file", path)
	return nil
}

func sanitize(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '@' || r == '.' || r == '-' || r == '_' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return '_'
	}, strings.ToLower(s))
}

// VerificationEmail builds the bilingual (中文 / English) code email.
func VerificationEmail(to, code string, ttl time.Duration) Message {
	mins := int(ttl.Minutes())
	text := fmt.Sprintf(`你的喵友圈验证码是：%s
%d 分钟内有效。如果不是你本人操作，请忽略这封邮件。

Your MeowSphere verification code is: %s
It expires in %d minutes. If you didn't request this, you can ignore this email.`, code, mins, code, mins)
	html := fmt.Sprintf(`<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;color:#292524">
<p>你的<b>喵友圈</b>验证码是 / Your <b>MeowSphere</b> verification code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0">%s</p>
<p>%d 分钟内有效 / Expires in %d minutes.</p>
<p style="color:#78716c;font-size:13px">如果不是你本人操作，请忽略这封邮件。<br>If you didn't request this, you can ignore this email.</p>
</div>`, code, mins, mins)
	return Message{To: to, Subject: fmt.Sprintf("喵友圈验证码 / MeowSphere code: %s", code), Text: text, HTML: html}
}

// PasswordResetEmail builds the bilingual (中文 / English) reset-code email.
func PasswordResetEmail(to, code string, ttl time.Duration) Message {
	mins := int(ttl.Minutes())
	text := fmt.Sprintf(`你正在重置喵友圈账号的密码，验证码是：%s
%d 分钟内有效。如果不是你本人操作，请忽略这封邮件，你的密码不会改变。

You asked to reset your MeowSphere password. Your code is: %s
It expires in %d minutes. If this wasn't you, ignore this email; your password won't change.`, code, mins, code, mins)
	html := fmt.Sprintf(`<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;color:#292524">
<p>重置<b>喵友圈</b>密码的验证码 / Your <b>MeowSphere</b> password reset code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0">%s</p>
<p>%d 分钟内有效 / Expires in %d minutes.</p>
<p style="color:#78716c;font-size:13px">如果不是你本人操作，请忽略这封邮件，你的密码不会改变。<br>If this wasn't you, ignore this email; your password won't change.</p>
</div>`, code, mins, mins)
	return Message{To: to, Subject: fmt.Sprintf("重置密码验证码 / Password reset code: %s", code), Text: text, HTML: html}
}
