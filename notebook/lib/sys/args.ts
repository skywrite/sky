// cross-runtime compatibility layer for CLI arguments
import process from 'node:process'

const args = process.argv.slice(2)
export default args
