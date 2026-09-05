// AI4S Workbench — Tauri 2 entry. Hosts the React frontend and supervises the
// bundled DSH sidecar (isolated config/data + dedicated port; killed on exit).
mod agent_audit;
mod artifact_file;
mod browser;
mod compute;
mod debug_log;
mod examples;
mod experiment_store;
mod gateway;
mod git_snapshot;
mod goal;
mod graphify;
mod harness;
mod jupyter;
mod kernel;
mod knowledge_base;
mod large_file;
#[cfg(target_os = "macos")]
mod macos;
mod materials_mcp;
mod modal;
mod model_catalog;
mod model_probe;
mod novomcp;
mod preview_server;
mod project;
mod provenance;
mod research_store;
mod runs;
mod runs_index;
mod runtime;
mod science_mcp;
mod ssh_session;
mod tools;
mod uv;

use graphify::GraphifyState;
use jupyter::JupyterState;
use kernel::KernelState;
use novomcp::NovoMcpState;
use preview_server::PreviewState;
use provenance::ProvenanceState;
use runtime::RuntimeState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance MUST be the first plugin. A second launch (or a reinstall
        // while the app is still running) focuses the existing window instead of
        // starting a second DSH instance on the same data dir (which deadlocks the DB).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(RuntimeState::default())
        .manage(agent_audit::AgentAuditState::default())
        .manage(KernelState::default())
        .manage(JupyterState::default())
        .manage(NovoMcpState::default())
        .manage(GraphifyState::default())
        .manage(PreviewState::default())
        .manage(ProvenanceState::default())
        .manage(runs::RunState::default())
        .manage(gateway::DesktopBridgeState::default())
        .manage(gateway::GatewayState::default())
        .manage(ssh_session::SshState::default())
        .setup(|app| {
            // Watch the active workspace so changes made outside the app (an
            // external editor, a detached process) still enqueue a debounced
            // snapshot. Re-pointed on every workspace switch in set_workspace.
            if let Ok(ws) = runtime::workspace_dir(app.handle()) {
                git_snapshot::watch_workspace(&ws);
            }
            // Bring the remote-access gateway back up if the user left it enabled.
            gateway::autostart(app.handle());
            // NovoMCP was removed from the connector catalog. Do not start a
            // legacy installation during launch; its imports can otherwise
            // delay the DeepSeek Harness connection for minutes.
            novomcp::disable_legacy_service(app.handle());
            Ok(())
        })
        // The transparent + vibrancy window loses tao's traffic-light inset on
        // some machines (tao only re-applies it from drawRect). Re-pin on the
        // events that cover launch, resize, and the in-app theme switch.
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if matches!(
                _event,
                tauri::WindowEvent::Focused(true)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ThemeChanged(_)
            ) {
                macos::reapply_traffic_light_inset(_window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime::start_runtime,
            runtime::refresh_model_catalog,
            runtime::remember_default_model,
            runtime::runtime_password,
            gateway::gateway_status,
            gateway::set_gateway_config,
            gateway::regenerate_gateway_token,
            runtime::stop_runtime,
            runtime::workspace_path,
            runtime::workspace_base,
            runtime::set_workspace_base,
            runtime::open_workspace_base,
            runtime::set_workspace,
            runtime::mark_session,
            runtime::new_dated_workspace,
            goal::goal_state,
            goal::goal_update,
            project::create_project,
            project::import_project,
            project::list_projects,
            project::rename_project,
            project::set_project_pinned,
            project::delete_project,
            project::open_project_folder,
            experiment_store::list_experiments,
            experiment_store::read_experiment,
            experiment_store::pick_experiment_files,
            experiment_store::update_experiment,
            experiment_store::set_experiment_archived,
            experiment_store::remove_experiment_record,
            experiment_store::sync_experiment_inbox,
            experiment_store::experiment_database_status,
            graphify::graphify_status,
            graphify::setup_graphify,
            graphify::graphify_index_project,
            graphify::graphify_index_conversation,
            graphify::graphify_list_scopes,
            graphify::graphify_read_graph,
            graphify::graphify_open_source,
            knowledge_base::knowledge_base_status,
            knowledge_base::knowledge_base_import,
            knowledge_base::knowledge_base_ensure,
            knowledge_base::knowledge_base_search,
            knowledge_base::knowledge_base_graph_search,
            knowledge_base::knowledge_base_articles,
            knowledge_base::knowledge_base_graph,
            runtime::pick_folder,
            runtime::write_export_file,
            runtime::install_skill_markdown,
            runtime::workspace_skill_names,
            runtime::adopt_workspace_skills,
            runtime::list_dsh_mcp_servers,
            runtime::set_dsh_mcp_server,
            runtime::remove_dsh_mcp_server,
            runtime::list_dsh_plugins,
            runtime::install_dsh_plugin,
            runtime::set_dsh_plugin,
            runtime::remove_dsh_plugin,
            model_probe::probe_endpoint_models,
            runtime::provider_auth_exists,
            jupyter::jupyter_status,
            jupyter::setup_jupyter,
            jupyter::start_jupyter,
            novomcp::novomcp_status,
            novomcp::setup_novomcp,
            novomcp::start_novomcp,
            novomcp::stop_novomcp,
            runtime::get_approval_mode,
            runtime::set_approval_mode,
            runtime::read_memory,
            runtime::write_memory,
            runtime::append_memory,
            runtime::get_memory_enabled,
            runtime::set_memory_enabled,
            runtime::get_agent_models,
            runtime::set_agent_model,
            runtime::get_agent_variants,
            runtime::set_agent_variant,
            runtime::get_proxy_setting,
            runtime::set_proxy_setting,
            runtime::get_mirror_setting,
            runtime::set_mirror_setting,
            browser::agent_browser_bin,
            browser::agent_browser_profiles,
            browser::detect_chrome,
            browser::setup_browser_chrome,
            kernel::kernel_execute,
            kernel::kernel_reset,
            kernel::python_interpreter,
            kernel::set_python_path,
            artifact_file::read_artifact,
            artifact_file::open_path,
            artifact_file::reveal_path,
            artifact_file::absolute_path,
            artifact_file::resolve_artifact,
            artifact_file::save_text_file,
            artifact_file::open_url,
            artifact_file::add_files_to_workspace,
            artifact_file::add_text_to_workspace,
            artifact_file::add_binary_to_workspace,
            artifact_file::add_paths_to_workspace,
            artifact_file::list_notebooks,
            artifact_file::list_dir,
            artifact_file::write_workspace_file,
            provenance::record_provenance,
            provenance::list_provenance,
            provenance::read_env_lockfile,
            research_store::list_research_graphs,
            research_store::read_research_graph,
            research_store::write_research_graph,
            agent_audit::record_agent_audit,
            agent_audit::list_agent_audit,
            runs::record_run,
            runs::list_runs,
            runs::read_run_log,
            runs_index::query_runs_cmd,
            science_mcp::science_mcp_python,
            science_mcp::setup_science_mcp,
            materials_mcp::materials_mcp_python,
            materials_mcp::setup_materials_mcp,
            materials_mcp::get_materials_workflow,
            materials_mcp::get_materials_workflow_scoped,
            materials_mcp::list_materials_workflows,
            materials_mcp::list_all_materials_workflows,
            materials_mcp::claim_materials_dft_human_review,
            materials_mcp::record_material_dft_human_review,
            examples::install_example,
            git_snapshot::commit_workspace_snapshot,
            compute::list_ssh_hosts,
            compute::compute_machines,
            compute::add_compute_machine,
            compute::remove_compute_machine,
            compute::compute_probe,
            compute::compute_jobs,
            compute::compute_cancel,
            ssh_session::ssh_connect,
            ssh_session::ssh_answer,
            ssh_session::ssh_disconnect,
            ssh_session::ssh_sessions,
            ssh_session::ssh_sharing_supported,
            modal::modal_status,
            preview_server::preview_url,
            large_file::probe_large_file,
            tools::detect_tools,
            tools::download_material_model,
            debug_log::log_debug
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI4S Workbench")
        .run(|app, event| {
            // Clean up on exit. macOS Cmd+Q / Quit terminates via RunEvent::Exit
            // (ExitRequested is not always delivered), so handle BOTH — otherwise
            // DSH sidecar / kernel / Jupyter orphan on every quit. The
            // cleanup is idempotent, so running on both is safe.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                runtime::kill_child(&app.state::<RuntimeState>());
                kernel::kill_kernel(&app.state::<KernelState>());
                jupyter::kill_jupyter(&app.state::<JupyterState>());
                novomcp::kill_novomcp(&app.state::<NovoMcpState>());
                gateway::shutdown(app.state::<gateway::GatewayState>().inner());
                gateway::shutdown_desktop_bridge(
                    app.state::<gateway::DesktopBridgeState>().inner(),
                );
                // An authenticated ssh channel must not outlive the app that
                // opened it (#73) — the master lives past our exit otherwise.
                ssh_session::shutdown(app);
            }
        });
}
