import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createEvaluationRun } from '../api/evaluations'
import { EvaluationIcon, CloseIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import type { DatasetInfo, EvaluationRun } from '../types/evaluations'

interface EvaluationCreateDialogProps {
  datasets: DatasetInfo[]
  onClose: () => void
  onCreated: (run: EvaluationRun) => void
}

function defaultRunName(): string {
  const stamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
  return `回归评测 ${stamp}`
}

export function EvaluationCreateDialog({
  datasets,
  onClose,
  onCreated,
}: EvaluationCreateDialogProps) {
  const [name, setName] = useState(defaultRunName)
  const [datasetName, setDatasetName] = useState(
    datasets[0]?.name ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const canSubmit =
    !saving &&
    name.trim().length > 0 &&
    name.trim().length <= 256 &&
    datasetName.length > 0

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const run = await createEvaluationRun(name.trim(), datasetName)
      onCreated(run)
    } catch (createError: unknown) {
      setError(
        createError instanceof Error ? createError.message : '创建评测任务失败',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="evaluation-create-title"
      className="evaluation-create-modal"
      closeDisabled={saving}
      onClose={onClose}
    >
      <form className="evaluation-create" onSubmit={submit}>
        <header className="evaluation-create__head">
          <span className="evaluation-create__icon" aria-hidden="true">
            <EvaluationIcon />
          </span>
          <div>
            <span className="evaluation-create__eyebrow">NEW EVALUATION RUN</span>
            <h2 id="evaluation-create-title">发起一轮 RAG 评测</h2>
          </div>
          <button
            type="button"
            className="evaluation-create__close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <p className="evaluation-create__lead">
          评测会在后台逐条执行数据集中的问题，计算 RAGAS 指标、引用命中率与拒答准确率。
          完成后可在任务详情中查看 Bad Case 并人工修正归因。
        </p>

        <label className="evaluation-field">
          <span>任务名称</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={256}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：差旅场景回归评测"
            disabled={saving}
          />
          <small>{name.trim().length} / 256</small>
        </label>

        <fieldset className="evaluation-datasets">
          <legend>选择评测集</legend>
          {datasets.length === 0 ? (
            <p className="evaluation-create__empty">
              后端没有发现可用评测集，请先确认 evaluation/datasets 目录。
            </p>
          ) : (
            <div className="evaluation-dataset-grid">
              {datasets.map((dataset) => (
                <button
                  key={dataset.name}
                  type="button"
                  className={`evaluation-dataset-option ${
                    datasetName === dataset.name ? 'is-selected' : ''
                  }`}
                  onClick={() => setDatasetName(dataset.name)}
                  disabled={saving}
                  aria-pressed={datasetName === dataset.name}
                >
                  <span className="evaluation-dataset-option__name">
                    {dataset.name}
                  </span>
                  <span className="evaluation-dataset-option__size">
                    {dataset.size} 条用例
                  </span>
                </button>
              ))}
            </div>
          )}
        </fieldset>

        {error ? (
          <p className="evaluation-create__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="evaluation-create__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!canSubmit}
          >
            {saving ? <Spinner small label="正在创建" /> : null}
            {saving ? '正在创建…' : '开始评测'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
