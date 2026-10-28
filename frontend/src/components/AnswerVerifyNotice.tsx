import { AlertIcon, ShieldCheckIcon } from './Icons'
import type { VerifyResult } from '../types/chat'

interface AnswerVerifyNoticeProps {
  result: VerifyResult | null
}

/**
 * 答案可信度校验状态。
 * verified=true 时只显示一行轻量徽标；校验失败时展示替换原因，避免用户误以为
 * 流式生成过程中看到的原始文本是最终答案。
 */
export function AnswerVerifyNotice({ result }: AnswerVerifyNoticeProps) {
  if (!result) {
    return null
  }

  if (result.verified) {
    const degradedReasons = [
      'verifier_exception',
      'verifier_parse_failed',
      'verifier_invalid_verified',
    ]
    const degraded = degradedReasons.includes(result.reason ?? '')

    if (degraded) {
      return (
        <div
          className="chat-verify chat-verify--muted"
          title={result.reason ?? undefined}
        >
          <ShieldCheckIcon className="icon" />
          <span>答案校验降级放行</span>
        </div>
      )
    }

    return (
      <div
        className="chat-verify chat-verify--ok"
        title={result.reason || '答案引用的片段能够支撑回答中的关键结论'}
      >
        <ShieldCheckIcon className="icon" />
        <span>答案已通过引用校验</span>
      </div>
    )
  }

  return (
    <div className="chat-verify chat-verify--warn" role="status">
      <span className="chat-verify__icon" aria-hidden="true">
        <AlertIcon className="icon" />
      </span>
      <div>
        <strong>答案校验未通过，已替换为拒答</strong>
        <p>
          {result.reason ||
            '生成内容未能得到引用片段的充分支撑，系统已阻止该回答。'}
        </p>
      </div>
    </div>
  )
}
