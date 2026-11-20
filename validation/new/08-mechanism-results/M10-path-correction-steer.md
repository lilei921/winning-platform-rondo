控制端已核对 M09 原脚本和真实 Git tree：Evidence 的正确路径是 evidence/fixture.json；初版 M10 探测脚本误用了 evidence.json，此为验证脚本错误，不是工件丢失。原预期 Hash 不变，已仅修正 m10-runtime-boundary.mjs 中的路径。

请先在当前 Task 复制 M10-runtime-boundary-evidence.json 为 M10-runtime-boundary-first-attempt.json，保留初跑失败；随后重新运行同一脚本，记录修正后的原始结果。无需再用 PowerShell 文本重编码实验推测 Hash，也不要改归档工件。收集 Runtime/Run 身份后完成报告，端到端仍为 NOT_RUN；不要将 Issue 手工设为 done。
