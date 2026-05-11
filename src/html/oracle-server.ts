//to do: Node RED type definitions
declare var RED_CONFIG: any; // Keep this name to avoid global scope collision

//
// -- oracle server --------------------------------------------------------------------------------
//
RED.nodes.registerType("oracle-server", {
    category: "config",
    defaults: {
        connectionname: { value: "", required: true },
        tnsname: { value: "" },
        connectiontype: { value: "Classic" },
        usethickmode: { value: false },
        instantclientpath: { value: "" },
        configdir: { value: "" },
        walletlocation: { value: "" },
        host: { value: "localhost", required: false },
        port: { value: 1521, required: false, validate: RED.validators.number() },
        db: { value: "", required: false },
        poolmin: { value: 0, required: false, validate: RED.validators.number(true) },
        poolmax: { value: 4, required: false, validate: RED.validators.number(true) },
        poolincrement: { value: 1, required: false, validate: RED.validators.number(true) },
        pooltimeout: { value: 60, required: false, validate: RED.validators.number(true) },
        queuetimeout: { value: 60000, required: false, validate: RED.validators.number(true) },
        stmtcachesize: { value: 30, required: false, validate: RED.validators.number(true) },
        maxretries: { value: 3, required: false, validate: RED.validators.number(true) },
        retrydelay: { value: 1000, required: false, validate: RED.validators.number(true) },
    },
    credentials: {
        user: { type: "text" },
        password: { type: "password" },
        walletpassword: { type: "password" }
    },
    label: function () {
        return this.connectionname;
    },
    oneditprepare: function () {
        const tabs = RED.tabs.create({
            id: "node-config-oracle-server-tabs",
            onchange: function (tab) {
                $("#node-config-oracle-server-tabs-content").children().hide();
                $("#" + tab.id).show();
            }
        });
        tabs.addTab({ id: "oracle-server-tab-connection", label: "Connection" });
        tabs.addTab({ id: "oracle-server-tab-security", label: "Security" });
        setTimeout(function () { tabs.resize(); }, 0);

        // --- Legacy migration detection ---
        // Pre-0.8 configs have instantclientpath set but no usethickmode field.
        // We coerce them into thick mode and show the migration warning.
        const self = this as any;
        const isLegacy = !!self.instantclientpath && (self.usethickmode === undefined || self.usethickmode === null);
        if (isLegacy) {
            $("#node-config-input-usethickmode").val("true");
            $("#legacy-thick-warning").show();
        } else {
            $("#node-config-input-usethickmode").val(self.usethickmode === true || self.usethickmode === "true" ? "true" : "false");
        }

        // --- Driver mode toggle ---
        function refreshModeFields() {
            const thick = String($("#node-config-input-usethickmode").val()) === "true";
            $(".thick-only").toggle(thick);
            $(".thin-only").toggle(!thick);
            // Hide the legacy warning if user has switched to thin
            if (!thick) $("#legacy-thick-warning").hide();
        }
        $("#node-config-input-usethickmode").on("change", refreshModeFields);
        refreshModeFields();

        // --- TNS alias auto-discovery from wallet/TNS_ADMIN ---
        function loadTnsAliases() {
            const dir = String($("#node-config-input-configdir").val() || "").trim();
            const wallet = String($("#node-config-input-walletlocation").val() || "").trim();
            const $status = $("#oracle-tns-status");
            const $list = $("#oracle-tns-aliases");
            const params: string[] = [];
            if (dir) params.push("dir=" + encodeURIComponent(dir));
            if (wallet) params.push("walletLocation=" + encodeURIComponent(wallet));
            $status.text("loading...");
            $.getJSON("oracle-server/tnsnames?" + params.join("&"), function (data) {
                $list.empty();
                if (data && Array.isArray(data.aliases) && data.aliases.length) {
                    data.aliases.forEach((a: string) => $list.append($("<option>").attr("value", a)));
                    $status.text(data.aliases.length + " aliases from " + data.source);
                } else if (data && data.error === "no_path") {
                    $status.text("(set Wallet / TNS_ADMIN, or TNS_ADMIN env, to auto-load)");
                } else if (data && data.error === "not_found") {
                    const tried = (data.tried || []).join(", ");
                    $status.text("no tnsnames.ora found (tried: " + tried + ")");
                } else {
                    $status.text("(no aliases found)");
                }
            }).fail(function () { $status.text("(load failed)"); });
        }
        $("#node-config-input-configdir, #node-config-input-walletlocation").on("change blur", loadTnsAliases);

        // If TNS_ADMIN is set in the Node-RED process env AND the user hasn't
        // configured their own configdir, auto-fill and lock the field — clearer
        // signal than a placeholder. "Edit" link lets them override.
        $.getJSON("oracle-server/env", function (env) {
            if (env && env.TNS_ADMIN) {
                const $cd = $("#node-config-input-configdir");
                if (!String($cd.val() || "").trim()) {
                    $cd.val(env.TNS_ADMIN).prop("readonly", true).css("background-color", "#f4f4f4");
                    $("#oracle-configdir-edit").show();
                    $("#oracle-configdir-from-env").show();
                    loadTnsAliases();
                }
                $("#oracle-configdir-edit").on("click", function (e) {
                    e.preventDefault();
                    $("#node-config-input-configdir").prop("readonly", false).css("background-color", "");
                    $("#oracle-configdir-edit").hide();
                    $("#oracle-configdir-from-env").hide();
                });
            }
        });
        loadTnsAliases();

        // --- Test Connection (shared by both buttons) ---
        function runTest($status: any, $result: any) {
            $status.html('<i class="fa fa-spinner fa-spin"></i> Testing...').css("color", "#888");
            $result.hide().empty();
            const body = {
                nodeId: (self as any).id || null,
                usethickmode: String($("#node-config-input-usethickmode").val()) === "true",
                instantclientpath: $("#node-config-input-instantclientpath").val(),
                configdir: $("#node-config-input-configdir").val(),
                walletlocation: $("#node-config-input-walletlocation").val(),
                walletpassword: $("#node-config-input-walletpassword").val(),
                tnsname: $("#node-config-input-tnsname").val(),
                host: $("#node-config-input-host").val(),
                port: $("#node-config-input-port").val(),
                db: $("#node-config-input-db").val(),
                user: $("#node-config-input-user").val(),
                password: $("#node-config-input-password").val()
            };
            $.ajax({
                url: "oracle-server/test",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify(body)
            }).done(function (data) {
                if (data.ok) {
                    const t = data.timing || {};
                    const timingTxt = t.connectMs != null ? ` · ${t.connectMs}ms connect, ${t.totalMs}ms total` : "";
                    $status.html('<i class="fa fa-check-circle"></i> Connected (' + data.mode + ' mode)' + timingTxt).css("color", "#3a8f3a");
                    const info = data.info || {};
                    const aliasesInWallet: string[] = [];
                    $("#oracle-tns-aliases option").each(function () { aliasesInWallet.push($(this).attr("value") as string); });
                    const lines = [
                        "Connect string : " + data.connectString,
                        "Database name  : " + (info.DB_NAME || "(n/a)"),
                        "Service name   : " + (info.SERVICE || "(n/a)"),
                        "Server host    : " + (info.SERVER_HOST || "(n/a)"),
                        "User           : " + (info.CURR_USER || "(n/a)"),
                        "Current schema : " + (info.CURR_SCHEMA || "(n/a)"),
                        "Connect time   : " + (t.connectMs != null ? t.connectMs + " ms" : "(n/a)"),
                        "Total time     : " + (t.totalMs != null ? t.totalMs + " ms" : "(n/a)")
                    ];
                    if (aliasesInWallet.length) {
                        lines.push("");
                        lines.push("Other services in wallet:");
                        aliasesInWallet.forEach(a => {
                            if (a !== body.tnsname) lines.push("  - " + a);
                        });
                    }
                    if (Array.isArray(data.schemas) && data.schemas.length) {
                        lines.push("");
                        lines.push("Accessible schemas (" + data.schemaTotal + "):");
                        const shown = data.schemas.slice(0, 30);
                        shown.forEach((s: string) => lines.push("  - " + s));
                        if (data.schemaTotal > shown.length) {
                            lines.push("  ... +" + (data.schemaTotal - shown.length) + " more");
                        }
                    }
                    $result.text(lines.join("\n")).show();
                } else {
                    const tFail = data.timing && data.timing.totalMs != null ? ` (after ${data.timing.totalMs}ms)` : "";
                    $status.html('<i class="fa fa-times-circle"></i> Failed' + tFail).css("color", "#c33");
                    $result.text("Error: " + data.error + "\nConnect string: " + data.connectString).show();
                }
            }).fail(function (xhr) {
                $status.html('<i class="fa fa-times-circle"></i> HTTP ' + xhr.status).css("color", "#c33");
            });
        }
        // --- Pool stats panel ---
        // The button toggles a panel that auto-refreshes every 2s while open.
        // Requires the config to be deployed (we need a node id to fetch stats).
        let statsTimer: any = null;
        (self as any)._stopStatsTimer = function () { if (statsTimer) { clearInterval(statsTimer); statsTimer = null; } };
        function fetchStats() {
            const id = (self as any).id;
            const $panel = $("#oracle-stats-panel");
            if (!id) {
                $panel.text("Save and Deploy this config first to inspect live pool stats.").show();
                return;
            }
            $.getJSON("oracle-server/" + encodeURIComponent(id) + "/stats", function (data) {
                if (!data.ok) {
                    $panel.text("Pool not available: " + (data.error || "unknown")).show();
                    return;
                }
                const s = data.summary;
                const lines = [
                    "Driver mode      : " + data.mode,
                    "Open / In use    : " + s.connectionsOpen + " / " + s.connectionsInUse,
                    "Pool bounds      : min=" + s.poolMin + ", max=" + s.poolMax,
                    "Queue length     : " + (s.queueLength != null ? s.queueLength : "(n/a)"),
                    "Queue max        : " + (s.queueMax != null ? s.queueMax : "(unlimited)"),
                    "",
                    "Peak in-use      : " + s.peakConnectionsInUse + " / " + s.poolMax,
                    "Peak queued      : " + s.peakQueueLength,
                    "Tracking since   : " + (s.peakSince || "(pool not started)"),
                    "Gathered         : " + s.gatheredAt
                ];
                // Sizing hints
                if (s.peakConnectionsInUse >= s.poolMax) {
                    lines.push("");
                    lines.push("⚠ Peak hit poolMax — consider raising Max Connections.");
                }
                if (s.peakQueueLength > 0) {
                    lines.push("⚠ Queue depth went above 0 — pool was saturated at least once.");
                }
                $panel.text(lines.join("\n")).show();
            }).fail(function () {
                $panel.text("Failed to fetch pool stats").show();
            });
        }
        $("#oracle-stats-btn").on("click", function () {
            if (statsTimer) {
                clearInterval(statsTimer); statsTimer = null;
                $("#oracle-stats-panel").hide();
            } else {
                fetchStats();
                statsTimer = setInterval(fetchStats, 2000);
            }
        });

        $("#oracle-test-btn").on("click", function () { runTest($("#oracle-test-status"), $("#oracle-test-result")); });
        $("#oracle-test-btn-sec").on("click", function () { runTest($("#oracle-test-status-sec"), $("#oracle-test-result-sec")); });

        // --- Classic vs TNS toggle (unchanged behavior) ---
        $(".connection-type").hide();
        $("#node-config-input-connectiontype").on("change", function (evt) {
            const ct = (<any>evt.currentTarget);
            if (ct.value === "TNS Name") {
                $("#wallet-container").show();
                $("#classic-container").hide();
                $("#node-config-input-host").val("");
                $("#node-config-input-port").val("");
                $("#node-config-input-db").val("");
            } else {
                $("#wallet-container").hide();
                $("#classic-container").show();
                $("#node-config-input-tnsname").val("");
            }
        }).trigger("change");
    },
    oneditsave: function () {
        // Coerce select-string back to boolean so the runtime sees a real bool.
        const v = String($("#node-config-input-usethickmode").val());
        (this as any).usethickmode = (v === "true");
        if ((this as any)._stopStatsTimer) (this as any)._stopStatsTimer();
    },
    oneditcancel: function () {
        if ((this as any)._stopStatsTimer) (this as any)._stopStatsTimer();
    }
});
