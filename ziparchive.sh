zip -r golden-vine-winery.zip . -x@zip_exclude_list.txt
# .env* / */.env* in zip_exclude_list.txt is intentionally broad (it has to
# catch .env wherever it's nested) and excludes the safe, git-tracked
# .env.example template along with it. Add it back explicitly rather than
# trying to carve a negation into the exclude patterns themselves.
zip golden-vine-winery.zip services/integration-service/.env.example