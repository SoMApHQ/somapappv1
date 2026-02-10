$lines = Get-Content workershtml/workertasks.html
for ($i=250; $i -le 310; $i++) {
  '{0}: {1}' -f $i, $lines[$i-1]
}
