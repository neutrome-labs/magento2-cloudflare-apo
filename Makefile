create-project:
	@echo "Creating project directory '$(name)'"
	
	mkdir $(name)
	ln -s ../src/ ./$(name)/src
	cp wrangler.jsonc $(name)/wrangler.jsonc
	sed -i "s/node_modules\/wrangler\/config-schema.json/..\/node_modules\/wrangler\/config-schema.json/g" $(name)/wrangler.jsonc
	sed -i "s/magento2-fpc-of-cloudflare-apo/$(name)-magento2-fpc-of-cloudflare-apo/g" $(name)/wrangler.jsonc

dev:
	@if [ "$(name)" != "" ]; then \
		cd $(name) && npx wrangler dev --local; \
	else \
		npx wrangler dev --local; \
	fi

deploy:
	@if [ "$(name)" != "" ]; then \
		cd $(name) && npx wrangler deploy; \
	else \
		npx wrangler deploy; \
	fi