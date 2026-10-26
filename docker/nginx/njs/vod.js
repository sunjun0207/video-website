function rewriteStatus(r) {
  if (r.status === 850) r.status = 200
}

export default { rewriteStatus }
